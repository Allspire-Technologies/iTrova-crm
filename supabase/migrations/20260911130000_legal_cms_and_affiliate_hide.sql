-- Legal documents in the CMS, the configured reward window in the earnings maths, and the
-- "hide from referrer" flag in the referral readers.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu). Apply AFTER the iTrova
-- migration 20260911130000_referral_policy_and_hide_flag (it adds the columns read here).

-- ---------------------------------------------------------------- 1. the reward window is configuration
-- Same definition as 20260801110000 (recorded payments win, estimate is the fallback, "source" says
-- which) except the two hard-coded twelve-month windows become referral_config.reward_window_months.
-- Changing that setting changes every referral's first-year value; the CRM says so beside the field.
drop view if exists public.cs_referral_revenue;
create view public.cs_referral_revenue as
with cfg as (
  select reward_window_months from public.referral_config limit 1
),
firsts as (
  select rp.business_id, min(rp.paid_at) as first_paid
  from public.cs_renewal_payment rp
  where rp.amount is not null and rp.amount > 0     -- ref-only rows aren't evidence of an amount
  group by rp.business_id
),
actuals as (
  select f.business_id, f.first_paid, sum(rp.amount) as total
  from firsts f
  cross join cfg
  join public.cs_renewal_payment rp
    on rp.business_id = f.business_id
   and rp.amount is not null and rp.amount > 0
   and rp.paid_at < (f.first_paid + make_interval(months => cfg.reward_window_months))  -- the configured window
  group by f.business_id, f.first_paid
)
select
  b.id                                                as business_id,
  b.subscription_tier                                 as plan_key,
  (x.is_paid or a.total is not null)                  as converted,
  coalesce(a.first_paid::timestamptz,
           case when x.is_paid then coalesce(b.subscription_started_at, b.created_at) end) as started_at,
  c.cycle_months,
  case when x.is_paid then cy.cycles else 0 end       as cycles,
  case when a.total is not null then round(a.total)
       when x.is_paid              then round(cy.cycles * pr.cycle_price)
       else 0 end                                     as revenue,
  case when a.total is not null then 'recorded' else 'estimated' end as source
from public.businesses b
cross join cfg
left join public.plans p on p.key = b.subscription_tier
left join actuals a on a.business_id = b.id
cross join lateral (
  select coalesce(b.subscription_tier, 'free') <> 'free'   as is_paid,
         lower(coalesce(b.subscription_cycle, 'monthly'))  as cyc
) x
cross join lateral (
  select case x.cyc when 'annual' then 12 when 'biannual' then 6 when 'quarterly' then 3 else 1 end as cycle_months
) c
left join public.plan_prices pp on pp.plan_id = p.id and pp.cycle = x.cyc
cross join lateral (
  select coalesce(
    round(pp.price_amount * (1 - coalesce(pp.discount_percent, 0) / 100.0)),
    round(coalesce(p.price_amount, 0) * c.cycle_months)
  ) as cycle_price
) pr
cross join lateral (
  select coalesce(b.subscription_started_at, b.created_at)  as start_at,
         least(now(), coalesce(b.subscription_renews_at, now())) as end_at
) w
cross join lateral (
  select ( extract(year  from age(w.end_at, w.start_at)) * 12
         + extract(month from age(w.end_at, w.start_at)) )::int as elapsed_months
) e
cross join lateral (
  select least(
    ceil(cfg.reward_window_months::numeric / c.cycle_months)::int,   -- the configured window's worth of cycles
    greatest(1, (e.elapsed_months / c.cycle_months)::int + 1)        -- cycles started so far
  ) as cycles
) cy;
revoke all on public.cs_referral_revenue from anon, authenticated;

-- ---------------------------------------------------------------- 2. referred signups carry the hide flag (CRM)
drop function if exists public.cs_referrals(text);
create or replace function public.cs_referrals(p_search text default null)
returns table (
  business_id uuid, business_name text, signed_up_at timestamptz, code text, referrer_name text,
  referrer_kind text, effective_share_percent numeric, plan_key text, first_paid_at date,
  total_paid_12m numeric, converted boolean, matched boolean, value_source text, hidden boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_share numeric; v_biz_share numeric;
begin
  select affiliate_share_percent, business_share_percent
    into v_share, v_biz_share from public.referral_config limit 1;
  return query
  select
    b.id, b.name, b.created_at, b.referred_by_code,
    coalesce(cr.name, rb.name),
    coalesce(cr.kind, case when rb.id is not null then 'business' end),
    coalesce(cr.share_percent,
             case when cr.kind = 'business' or (cr.code is null and rb.id is not null) then v_biz_share else v_share end),
    rv.plan_key, rv.started_at::date, coalesce(rv.revenue, 0), coalesce(rv.converted, false),
    (cr.code is not null or rb.id is not null),
    rv.source,
    coalesce(b.hide_from_referrer, false)
  from public.businesses b
  left join public.cs_referrer cr on upper(cr.code) = upper(b.referred_by_code)
  left join public.businesses rb on rb.id <> b.id and upper(rb.referral_code) = upper(b.referred_by_code)
  left join public.cs_referral_revenue rv on rv.business_id = b.id
  where b.referred_by_code is not null
    and public.cs_can_see_business(b.id)
    and (p_search is null or p_search = ''
      or b.name ilike '%' || p_search || '%' or b.referred_by_code ilike '%' || p_search || '%'
      or coalesce(cr.name, rb.name) ilike '%' || p_search || '%')
  order by b.created_at desc;
end $$;
revoke all on function public.cs_referrals(text) from public, anon;
grant execute on function public.cs_referrals(text) to authenticated;

-- ---------------------------------------------------------------- 3. the affiliate's list anonymises hidden businesses
-- Status and earnings are unchanged; only the identity is withheld (the reward was still earned).
drop function if exists public.my_affiliate_referrals();
create or replace function public.my_affiliate_referrals()
returns table (
  business_id uuid, business_name text, owner_email text, signed_up_at timestamptz,
  plan_key text, cycle text, status text, started_at date, earned numeric, hidden boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._my_affiliate())
  select
    rb.id,
    case when rb.hide_from_referrer then 'A referred business' else rb.name end,
    case when rb.hide_from_referrer then null else (select au.email::text from auth.users au where au.id = rb.owner_id) end,
    rb.created_at,
    rv.plan_key,
    rb.subscription_cycle,
    case
      when not coalesce(rv.converted, false) then 'signed_up'
      when public._effective_tier(rb.id) = 'free' then 'lapsed'
      else 'paying'
    end,
    rv.started_at::date,
    public._referral_reward('affiliate', me.share, rv.plan_key, rv.revenue, me.bonus, rv.converted),
    coalesce(rb.hide_from_referrer, false)
  from me
  join public.businesses rb on upper(rb.referred_by_code) = upper(me.code)
  left join public.cs_referral_revenue rv on rv.business_id = rb.id
  order by rb.created_at desc;
$$;
revoke all on function public.my_affiliate_referrals() from public, anon;
grant execute on function public.my_affiliate_referrals() to authenticated;

-- ---------------------------------------------------------------- 4. setting the flag from the CRM
-- Admin, or support assigned to the business: the same gate as emailing a customer.
create or replace function public.cs_set_hide_from_referrer(p_business_id uuid, p_hidden boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.cs_my_role() not in ('admin', 'support') or not public.cs_can_see_business(p_business_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.businesses set hide_from_referrer = coalesce(p_hidden, false) where id = p_business_id;
  if not found then raise exception 'Business not found' using errcode = 'P0002'; end if;
  return coalesce(p_hidden, false);
end $$;
revoke all on function public.cs_set_hide_from_referrer(uuid, boolean) from public, anon;
grant execute on function public.cs_set_hide_from_referrer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4b. customer detail shows the flag
-- Return type gains hide_from_referrer, so DROP first (42P13).
drop function if exists public.admin_business_profile(uuid);
create or replace function public.admin_business_profile(p_business_id uuid)
returns table (industry text, owner_email text, referred_by_code text, referral_code text, owner_email_confirmed_at timestamptz, hide_from_referrer boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    coalesce(to_jsonb(b) ->> 'industry', to_jsonb(b) ->> 'business_type', to_jsonb(b) ->> 'category', to_jsonb(b) ->> 'sector') as industry,
    (select au.email::text from auth.users au where au.id = b.owner_id) as owner_email,
    (to_jsonb(b) ->> 'referred_by_code') as referred_by_code,
    (to_jsonb(b) ->> 'referral_code') as referral_code,
    (select au.email_confirmed_at from auth.users au where au.id = b.owner_id) as owner_email_confirmed_at,
    coalesce(b.hide_from_referrer, false)
  from public.businesses b
  where b.id = p_business_id and public.cs_can_see_business(p_business_id);
end $$;
revoke all on function public.admin_business_profile(uuid) from public, anon;
grant execute on function public.admin_business_profile(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. legal documents, per site
-- One row per version of each document. The sites serve the latest published version per slug;
-- older rows stay as the record of what the policy said on a given date. Placeholders such as
-- {{affiliate_share_percent}} are filled by the site from the public pricing feed.

create table if not exists public.cms_legal_doc (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,                       -- terms | privacy | dpa | affiliate-terms
  title        text not null,
  body_md      text not null,
  effective_at date not null,                       -- one row per version; the latest published one is served
  published    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (slug, effective_at)
);
create index if not exists cms_legal_doc_slug_idx on public.cms_legal_doc (slug, published, effective_at desc);
drop trigger if exists set_updated_at on public.cms_legal_doc;
create trigger set_updated_at before update on public.cms_legal_doc
  for each row execute function public.cs_set_updated_at();

alter table public.cms_legal_doc enable row level security;
revoke all on public.cms_legal_doc from anon, authenticated;
drop policy if exists "legal public read" on public.cms_legal_doc;
create policy "legal public read" on public.cms_legal_doc for select to anon, authenticated using (published);
drop policy if exists "legal staff read" on public.cms_legal_doc;
create policy "legal staff read" on public.cms_legal_doc for select to authenticated using (public.cs_my_role() is not null);
drop policy if exists "legal admin write" on public.cms_legal_doc;
create policy "legal admin write" on public.cms_legal_doc for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
grant select on public.cms_legal_doc to anon;
grant select, insert, update, delete on public.cms_legal_doc to authenticated;
grant select, insert, update, delete on public.cms_legal_doc to service_role;


create table if not exists public.as_legal_doc (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,                       -- terms | privacy | dpa | affiliate-terms
  title        text not null,
  body_md      text not null,
  effective_at date not null,                       -- one row per version; the latest published one is served
  published    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (slug, effective_at)
);
create index if not exists as_legal_doc_slug_idx on public.as_legal_doc (slug, published, effective_at desc);
drop trigger if exists set_updated_at on public.as_legal_doc;
create trigger set_updated_at before update on public.as_legal_doc
  for each row execute function public.cs_set_updated_at();

alter table public.as_legal_doc enable row level security;
revoke all on public.as_legal_doc from anon, authenticated;
drop policy if exists "legal public read" on public.as_legal_doc;
create policy "legal public read" on public.as_legal_doc for select to anon, authenticated using (published);
drop policy if exists "legal staff read" on public.as_legal_doc;
create policy "legal staff read" on public.as_legal_doc for select to authenticated using (public.cs_my_role() is not null);
drop policy if exists "legal admin write" on public.as_legal_doc;
create policy "legal admin write" on public.as_legal_doc for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');
grant select on public.as_legal_doc to anon;
grant select, insert, update, delete on public.as_legal_doc to authenticated;
grant select, insert, update, delete on public.as_legal_doc to service_role;


-- Seed: the documents exactly as the sites render them today, so switching the pages to the CMS
-- changes nothing a reader sees.
insert into public.cms_legal_doc (slug, title, body_md, effective_at, published) values
  ('terms', 'Terms of Service', $md$These Terms of Service ("Terms") govern access to and use of iTrova, a business management platform operated by Allspire Technologies Limited. By creating an account or using the platform, you agree to these Terms.

## 1. Eligibility

You must be at least 18 years old and have authority to act on behalf of a business or organization to use iTrova.

## 2. Account Registration

Users must provide accurate information during registration. You are responsible for:
- Maintaining account security
- Protecting passwords
- Activities occurring under your account

## 3. Subscription Plans

iTrova offers various subscription plans. Subscription fees are charged according to the selected plan. Features available may vary based on subscription level.

## 4. Billing and Payments

Subscription fees are payable in advance. Failure to pay subscription fees may result in:
- Suspension of access
- Restricted functionality
- Account termination

Fees paid are generally non-refundable unless required by law.

## 5. Customer Data Ownership

Customers retain ownership of all business data uploaded to iTrova. This includes:
- Inventory records
- Sales records
- Supplier records
- Staff information
- Invoices
- Reports

Allspire Technologies Limited does not claim ownership of customer data.

## 6. License to Use the Platform

Subject to compliance with these Terms, iTrova grants customers a limited, non-exclusive, non-transferable license to access and use the platform.

## 7. Acceptable Use

Users may not:
- Use the platform for unlawful activities
- Attempt unauthorized access
- Reverse engineer the software
- Distribute malware
- Interfere with platform operations
- Upload harmful or fraudulent content

## 8. Availability of Service

We aim to provide reliable service but do not guarantee uninterrupted availability. Maintenance, upgrades, outages, or external factors may occasionally affect access.

## 9. Third-Party Services

The platform may integrate with third-party services including payment providers, communication services, or external APIs. We are not responsible for third-party services beyond our reasonable control.

## 10. Intellectual Property

All software, branding, designs, trademarks, documentation, and platform content remain the property of Allspire Technologies Limited. No ownership rights are transferred to users.

## 11. Limitation of Liability

To the fullest extent permitted by law, Allspire Technologies Limited shall not be liable for:
- Loss of profits
- Loss of business opportunities
- Data loss
- Indirect damages
- Consequential damages

Total liability shall not exceed fees paid by the customer during the twelve months preceding the claim.

## 12. Indemnification

Users agree to indemnify and hold harmless Allspire Technologies Limited from claims arising from:
- Misuse of the platform
- Violation of these Terms
- Violation of applicable laws

## 13. Suspension and Termination

We may suspend or terminate accounts where:
- Terms are violated
- Fraud is suspected
- Fees remain unpaid
- Security risks arise

Customers may cancel subscriptions according to applicable billing policies.

## 14. Changes to the Service

We may modify, improve, or discontinue features from time to time. Reasonable notice will be provided where practical.

## 15. Governing Law

These Terms shall be governed by the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the jurisdiction of competent courts in Nigeria.

## 16. Contact Information

Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  Questions regarding these Terms may be directed to the above contact details.

);

export default Terms;$md$, '2026-04-06', true),
  ('privacy', 'Privacy Policy', $md$iTrova ("iTrova", "we", "our", or "us") is a business management platform owned and operated by Allspire Technologies Limited. This Privacy Policy explains how we collect, use, disclose, store, and protect personal and business information when you use the iTrova platform, website, mobile applications, and related services. By accessing or using iTrova, you agree to the collection and use of information in accordance with this Privacy Policy.

## 1. Information We Collect

### Business Information

When you register for iTrova, we may collect:
- Business name
- Business address
- Industry type
- Business logo
- Business contact information
- Subscription plan information

### User Information

We may collect:
- Full name
- Email address
- Phone number
- Job role
- Login credentials

### Operational Data

Information generated while using iTrova, including:
- Products and inventory records
- Supplier information
- Invoice data
- Sales records
- Staff activity logs
- Reports and analytics

### Technical Information

We automatically collect:
- Device information
- Browser type
- Operating system
- IP address
- Login timestamps
- Usage data

## 2. How We Use Information

We use collected information to:
- Provide and maintain the platform
- Process subscriptions and payments
- Authenticate users
- Generate reports and analytics
- Improve platform functionality
- Provide customer support
- Prevent fraud and unauthorized access
- Comply with legal obligations

## 3. AI Features

Where AI-powered insights are provided, business data may be processed to generate recommendations, reports, forecasts, and operational insights. We do not sell customer business data to third parties. AI-generated recommendations should be considered advisory only and should not replace professional business, financial, or legal judgment.

## 4. Data Sharing

We do not sell customer data. We may share information with:
- Cloud infrastructure providers
- Payment processors
- Email and communication service providers
- Analytics providers
- Government authorities when legally required

All third-party providers are required to maintain appropriate security standards.

**Referral programme.** If a business signs up through an affiliate's referral link or code, we show that affiliate the business's name, the email address of its owner, whether the business has signed up, is paying or has lapsed, and the reward it has earned them. This lets the affiliate recognise the businesses they introduced and follow up with them. Affiliates agree to use this information only for the referral programme, not to share or sell it, and to delete it on request, under our Affiliate Programme Terms. If you signed up through a referral and do not want the affiliate to see these details, contact us using the details below and we will remove your business from their view.

## 5. Data Security

We implement reasonable administrative, technical, and organizational safeguards including:
- Encrypted data transmission
- Secure authentication systems
- Role-based access controls
- Database security controls
- Activity monitoring and logging

No system is completely secure and we cannot guarantee absolute security.

## 6. Data Retention

We retain customer data while accounts remain active. Upon account termination, data may be retained for legal, regulatory, backup, and security purposes for a reasonable period before permanent deletion.

## 7. User Rights

Subject to applicable laws, users may:
- Access their information
- Correct inaccurate information
- Request deletion of personal data
- Request data portability
- Object to certain processing activities

Requests may be submitted to  [privacy@allspire.tech](mailto:privacy@allspire.tech).

## 8. Cookies and Tracking

We may use cookies and similar technologies to:
- Maintain sessions
- Improve performance
- Analyze usage
- Enhance user experience

Users may control cookie preferences through browser settings.

## 9. Children's Privacy

iTrova is intended for business users and is not directed toward individuals under 18 years of age.

## 10. International Transfers

Where data is processed outside Nigeria, we will take reasonable steps to ensure adequate protection consistent with applicable data protection laws.

## 11. Changes to this Policy

We may update this Privacy Policy from time to time. Updated versions will be published on our website and platform.

## 12. Contact Information

Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  For privacy-related concerns, users may contact us using the details above.

);

export default Privacy;$md$, '2026-06-06', true),
  ('dpa', 'Data Processing Agreement', $md$This Data Processing Agreement ("DPA") forms part of the Terms of Service between Allspire Technologies Limited, owner and operator of iTrova ("Processor", "iTrova", "we", "us"), and the customer organization using the iTrova platform ("Controller", "Customer", "you"). This DPA governs the processing of Personal Data and Business Data in connection with the Customer's use of the iTrova platform.

## 1. Purpose

The purpose of this DPA is to define the responsibilities of both parties regarding the collection, processing, storage, transfer, and protection of Personal Data processed through iTrova. This DPA is intended to support compliance with:
- Nigerian Data Protection Act (NDPA) 2023
- Applicable data protection regulations
- Any other relevant privacy laws applicable to the Customer

## 2. Definitions

### Controller

The Customer who determines the purpose and means of processing Personal Data.

### Processor

Allspire Technologies Limited, acting through the iTrova platform, which processes Personal Data on behalf of the Customer.

### Personal Data

Any information relating to an identified or identifiable individual. Examples include:
- Names
- Email addresses
- Phone numbers
- Employee records
- Supplier contact details
- Customer contact information

### Business Data

Any operational data stored within iTrova including:
- Inventory records
- Product information
- Supplier information
- Invoices
- Sales transactions
- Reports
- Staff activity logs

## 3. Scope of Processing

iTrova processes Customer Data solely for the purpose of providing the Services. Processing activities may include:
- Storage
- Organization
- Analysis
- Retrieval
- Reporting
- Backup and recovery
- Security monitoring

iTrova shall not process Customer Data for any unrelated purpose without authorization.

## 4. Customer Responsibilities

The Customer agrees to:
- Obtain all necessary consents required by law
- Ensure the lawful collection of Personal Data
- Maintain accuracy of uploaded information
- Configure user permissions appropriately
- Notify iTrova of any legal restrictions affecting processing

The Customer remains the owner and controller of all Customer Data.

## 5. Processor Obligations

iTrova shall:
- Process data only on documented instructions from the Customer
- Maintain appropriate security controls
- Restrict access to authorized personnel only
- Implement reasonable safeguards against unauthorized access
- Maintain confidentiality obligations for employees and contractors
- Assist Customers in responding to lawful data requests where reasonably possible

## 6. Data Security Measures

iTrova maintains reasonable technical and organizational safeguards including:

### Access Controls
- Role-based permissions
- Authentication controls
- Session management

### Infrastructure Security
- Secure cloud hosting
- Encrypted data transmission
- Firewall protections
- Monitoring and logging

### Operational Security
- Access restriction policies
- Incident response procedures
- Backup and recovery processes

While iTrova implements reasonable safeguards, no system can guarantee absolute security.

## 7. Subprocessors

The Customer authorizes iTrova to engage trusted subprocessors necessary to operate the platform. Examples may include:
- Cloud hosting providers
- Authentication providers
- Email delivery services
- Payment processors
- Analytics services

iTrova shall take reasonable steps to ensure subprocessors maintain appropriate security standards.

## 8. International Data Transfers

Customer Data may be processed in jurisdictions outside Nigeria where cloud infrastructure providers operate. Where international transfers occur, iTrova will take reasonable measures to ensure adequate protection of Customer Data.

## 9. Data Subject Requests

Where applicable, iTrova shall provide reasonable assistance to Customers responding to requests relating to:
- Access
- Correction
- Deletion
- Portability
- Restriction of processing

The Customer remains primarily responsible for responding to such requests.

## 10. Security Incident Notification

In the event of a confirmed security incident affecting Customer Data, iTrova shall:
- Investigate the incident
- Take reasonable steps to mitigate risks
- Notify affected Customers without undue delay where required by law
- Provide available information regarding the nature and impact of the incident

Notification does not constitute an admission of fault or liability.

## 11. Data Retention and Deletion

Customer Data shall be retained during the active subscription period. Upon account termination:
- Customers may request export of their data
- Certain records may be retained for legal, security, audit, billing, or backup purposes
- Data will be deleted according to iTrova's retention policies and applicable legal requirements

## 12. Audit Rights

Upon reasonable written request and no more than once annually, Customers may request information regarding iTrova's security and privacy controls. iTrova may satisfy such requests through:
- Security questionnaires
- Compliance documentation
- Policy reviews

Requests must not compromise platform security or other customers' confidentiality.

## 13. Confidentiality

Both parties agree to maintain the confidentiality of all non-public information exchanged under this Agreement. Confidential information shall not be disclosed except:
- With written consent
- To authorized personnel with a legitimate need to know
- Where required by law

## 14. Limitation of Liability

Liability under this DPA shall be subject to the limitations contained within the iTrova Terms of Service. Nothing in this DPA expands either party's liability beyond those agreed limitations.

## 15. Term and Termination

This DPA shall remain in effect for as long as Customer Data is processed by iTrova. Termination of the underlying subscription agreement shall automatically terminate this DPA, except for provisions that survive termination by their nature.

## 16. Contact Information

Data Protection Contact  Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  Questions regarding this DPA may be submitted to the above contact details.

);

export default Dpa;$md$, '2026-06-06', true),
  ('affiliate-terms', 'Affiliate Programme Terms', $md$These terms govern the iTrova affiliate programme, run by Allspire Technologies Limited. By applying to the programme, or by using an affiliate referral code, link or dashboard, you agree to them. They sit alongside the iTrova [Terms of Service](/terms) and [Privacy Policy](/privacy).

## 1. Eligibility

You must be at least 18 years old. Applications are reviewed by hand and we may decline or accept any application at our discretion. Once approved you receive a personal referral code and link. Employees of Allspire Technologies Limited take part under a separate internal arrangement, not these terms.

## 2. How referrals are attributed

A business is attributed to you when it creates its iTrova account through your link or enters your code at sign-up. Attribution is fixed at sign-up and cannot be added afterwards. A business can be attributed to only one referrer. A business that signs up through your link receives **{{referee_discount_percent}}% off** its first payment.

## 3. Your reward
- You earn **{{affiliate_share_percent}}%** of the subscription payments a business you referred makes in its first {{reward_window_months}} months on a paid plan, counted from the day it first moves to a paid plan.
- Nothing is earned while a referred business is on the free plan or a trial.
- Earnings are calculated from the plan and billing cycle the business is on. After its first {{reward_window_months}} months a business stops earning you anything; new referrals earn on their own first year.
- Payouts are made monthly, within {{payout_within_days}} days of the end of the month, by bank transfer to the account you enter on your dashboard. You confirm those details are correct when you save them; once we have paid you they lock, and can be changed only by asking us.
- Payouts are made in Nigerian naira. We may set a minimum payout amount and carry smaller balances forward.

## 4. Clawback and lapse

If a referred business receives a refund, disputes a payment, or stops paying within its first {{clawback_months}} months, the reward for that business is reversed. Where it has already been paid to you, it is deducted from your next payout. Once a referred business stops paying, it stops earning you anything from that point, and its earlier earnings stand.

## 5. What you can see about businesses you refer

Your dashboard shows, for each business attributed to you, its name, the email address of its owner, whether it has signed up, is paying or has lapsed, and what it has earned you. This is shared with you so you can recognise your own referrals and follow up with people you introduced. In return you agree:
- to use this information only in connection with the programme;
- not to sell, share or publish it, or add it to any marketing list;
- to delete it if we ask, or if you leave the programme;
- to handle it in line with Nigerian data protection law.

## 6. Fair play and ending participation
- You may not refer yourself, a business you own or control, or a business that is already an iTrova customer.
- You may not create fake sign-ups, pay or otherwise induce people to sign up without a genuine intention to use iTrova, or misrepresent iTrova or its prices.
- You may not present yourself as Allspire Technologies Limited or as an employee of it, or run advertising on the iTrova or Allspire names without our written agreement.
- An unusual burst of sign-ups may be held for review before it is paid.
- We may suspend or end your participation at any time if these terms are broken. Legitimate earnings already accrued are still paid. Either of us can end participation on notice for any other reason; earnings accrued to that date are paid on the normal schedule.

## 7. Tax

Commissions may be subject to Nigerian withholding tax, which we deduct and remit at the statutory rate where the law requires it. You are responsible for any other tax due on what you earn from the programme and for keeping your own records.

## 8. Changes to the programme

We may change the reward rate, the referee discount, the payout schedule or these terms. Changes apply to referrals made after the change is published on this page; earnings already accrued are not reduced. The rates shown on this page are always the rates currently in force.

## 9. Contact

Questions about the programme, a payout, or these terms: [hello@allspire.tech](`mailto:$hello@allspire.tech`). Allspire Technologies Limited, RC 9702176, Lagos, Nigeria.

  );

export default AffiliateTerms;$md$, '2026-09-11', true)
on conflict (slug, effective_at) do nothing;

insert into public.as_legal_doc (slug, title, body_md, effective_at, published) values
  ('terms', 'Terms of Service', $md$These Terms of Service ("Terms") govern access to and use of iTrova, a business management platform operated by Allspire Technologies Limited. By creating an account or using the platform, you agree to these Terms.

## 1. Eligibility

You must be at least 18 years old and have authority to act on behalf of a business or organization to use iTrova.

## 2. Account Registration

Users must provide accurate information during registration. You are responsible for:
- Maintaining account security
- Protecting passwords
- Activities occurring under your account

## 3. Subscription Plans

iTrova offers various subscription plans. Subscription fees are charged according to the selected plan. Features available may vary based on subscription level.

## 4. Billing and Payments

Subscription fees are payable in advance. Failure to pay subscription fees may result in:
- Suspension of access
- Restricted functionality
- Account termination

Fees paid are generally non-refundable unless required by law.

## 5. Customer Data Ownership

Customers retain ownership of all business data uploaded to iTrova. This includes:
- Inventory records
- Sales records
- Supplier records
- Staff information
- Invoices
- Reports

Allspire Technologies Limited does not claim ownership of customer data.

## 6. License to Use the Platform

Subject to compliance with these Terms, iTrova grants customers a limited, non-exclusive, non-transferable license to access and use the platform.

## 7. Acceptable Use

Users may not:
- Use the platform for unlawful activities
- Attempt unauthorized access
- Reverse engineer the software
- Distribute malware
- Interfere with platform operations
- Upload harmful or fraudulent content

## 8. Availability of Service

We aim to provide reliable service but do not guarantee uninterrupted availability. Maintenance, upgrades, outages, or external factors may occasionally affect access.

## 9. Third-Party Services

The platform may integrate with third-party services including payment providers, communication services, or external APIs. We are not responsible for third-party services beyond our reasonable control.

## 10. Intellectual Property

All software, branding, designs, trademarks, documentation, and platform content remain the property of Allspire Technologies Limited. No ownership rights are transferred to users.

## 11. Limitation of Liability

To the fullest extent permitted by law, Allspire Technologies Limited shall not be liable for:
- Loss of profits
- Loss of business opportunities
- Data loss
- Indirect damages
- Consequential damages

Total liability shall not exceed fees paid by the customer during the twelve months preceding the claim.

## 12. Indemnification

Users agree to indemnify and hold harmless Allspire Technologies Limited from claims arising from:
- Misuse of the platform
- Violation of these Terms
- Violation of applicable laws

## 13. Suspension and Termination

We may suspend or terminate accounts where:
- Terms are violated
- Fraud is suspected
- Fees remain unpaid
- Security risks arise

Customers may cancel subscriptions according to applicable billing policies.

## 14. Changes to the Service

We may modify, improve, or discontinue features from time to time. Reasonable notice will be provided where practical.

## 15. Governing Law

These Terms shall be governed by the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the jurisdiction of competent courts in Nigeria.

## 16. Contact Information

Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  Questions regarding these Terms may be directed to the above contact details.

  );
export default TermsOfService;$md$, '2026-04-06', true),
  ('privacy', 'Privacy Policy', $md$iTrova ("iTrova", "we", "our", or "us") is a business management platform owned and operated by Allspire Technologies Limited. This Privacy Policy explains how we collect, use, disclose, store, and protect personal and business information when you use the iTrova platform, website, mobile applications, and related services. By accessing or using iTrova, you agree to the collection and use of information in accordance with this Privacy Policy.

## 1. Information We Collect

### Business Information

When you register for iTrova, we may collect:
- Business name
- Business address
- Industry type
- Business logo
- Business contact information
- Subscription plan information

### User Information

We may collect:
- Full name
- Email address
- Phone number
- Job role
- Login credentials

### Operational Data

Information generated while using iTrova, including:
- Products and inventory records
- Supplier information
- Invoice data
- Sales records
- Staff activity logs
- Reports and analytics

### Technical Information

We automatically collect:
- Device information
- Browser type
- Operating system
- IP address
- Login timestamps
- Usage data

## 2. How We Use Information

We use collected information to:
- Provide and maintain the platform
- Process subscriptions and payments
- Authenticate users
- Generate reports and analytics
- Improve platform functionality
- Provide customer support
- Prevent fraud and unauthorized access
- Comply with legal obligations

## 3. AI Features

Where AI-powered insights are provided, business data may be processed to generate recommendations, reports, forecasts, and operational insights. We do not sell customer business data to third parties. AI-generated recommendations should be considered advisory only and should not replace professional business, financial, or legal judgment.

## 4. Data Sharing

We do not sell customer data. We may share information with:
- Cloud infrastructure providers
- Payment processors
- Email and communication service providers
- Analytics providers
- Government authorities when legally required

All third-party providers are required to maintain appropriate security standards.

**Referral programme.** If a business signs up through an affiliate's referral link or code, we show that affiliate the business's name, the email address of its owner, whether the business has signed up, is paying or has lapsed, and the reward it has earned them. This lets the affiliate recognise the businesses they introduced and follow up with them. Affiliates agree to use this information only for the referral programme, not to share or sell it, and to delete it on request, under our Affiliate Programme Terms. If you signed up through a referral and do not want the affiliate to see these details, contact us using the details below and we will remove your business from their view.

## 5. Data Security

We implement reasonable administrative, technical, and organizational safeguards including:
- Encrypted data transmission
- Secure authentication systems
- Role-based access controls
- Database security controls
- Activity monitoring and logging

No system is completely secure and we cannot guarantee absolute security.

## 6. Data Retention

We retain customer data while accounts remain active. Upon account termination, data may be retained for legal, regulatory, backup, and security purposes for a reasonable period before permanent deletion.

## 7. User Rights

Subject to applicable laws, users may:
- Access their information
- Correct inaccurate information
- Request deletion of personal data
- Request data portability
- Object to certain processing activities

Requests may be submitted to  [privacy@allspire.tech](mailto:privacy@allspire.tech).

## 8. Cookies and Tracking

We may use cookies and similar technologies to:
- Maintain sessions
- Improve performance
- Analyze usage
- Enhance user experience

Users may control cookie preferences through browser settings.

## 9. Children's Privacy

iTrova is intended for business users and is not directed toward individuals under 18 years of age.

## 10. International Transfers

Where data is processed outside Nigeria, we will take reasonable steps to ensure adequate protection consistent with applicable data protection laws.

## 11. Changes to this Policy

We may update this Privacy Policy from time to time. Updated versions will be published on our website and platform.

## 12. Contact Information

Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  For privacy-related concerns, users may contact us using the details above.

  );
export default PrivacyPolicy;$md$, '2026-06-06', true),
  ('dpa', 'Data Processing Agreement', $md$This Data Processing Agreement ("DPA") forms part of the Terms of Service between Allspire Technologies Limited, owner and operator of iTrova ("Processor", "iTrova", "we", "us"), and the customer organization using the iTrova platform ("Controller", "Customer", "you"). This DPA governs the processing of Personal Data and Business Data in connection with the Customer's use of the iTrova platform.

## 1. Purpose

The purpose of this DPA is to define the responsibilities of both parties regarding the collection, processing, storage, transfer, and protection of Personal Data processed through iTrova. This DPA is intended to support compliance with:
- Nigerian Data Protection Act (NDPA) 2023
- Applicable data protection regulations
- Any other relevant privacy laws applicable to the Customer

## 2. Definitions

### Controller

The Customer who determines the purpose and means of processing Personal Data.

### Processor

Allspire Technologies Limited, acting through the iTrova platform, which processes Personal Data on behalf of the Customer.

### Personal Data

Any information relating to an identified or identifiable individual. Examples include:
- Names
- Email addresses
- Phone numbers
- Employee records
- Supplier contact details
- Customer contact information

### Business Data

Any operational data stored within iTrova including:
- Inventory records
- Product information
- Supplier information
- Invoices
- Sales transactions
- Reports
- Staff activity logs

## 3. Scope of Processing

iTrova processes Customer Data solely for the purpose of providing the Services. Processing activities may include:
- Storage
- Organization
- Analysis
- Retrieval
- Reporting
- Backup and recovery
- Security monitoring

iTrova shall not process Customer Data for any unrelated purpose without authorization.

## 4. Customer Responsibilities

The Customer agrees to:
- Obtain all necessary consents required by law
- Ensure the lawful collection of Personal Data
- Maintain accuracy of uploaded information
- Configure user permissions appropriately
- Notify iTrova of any legal restrictions affecting processing

The Customer remains the owner and controller of all Customer Data.

## 5. Processor Obligations

iTrova shall:
- Process data only on documented instructions from the Customer
- Maintain appropriate security controls
- Restrict access to authorized personnel only
- Implement reasonable safeguards against unauthorized access
- Maintain confidentiality obligations for employees and contractors
- Assist Customers in responding to lawful data requests where reasonably possible

## 6. Data Security Measures

iTrova maintains reasonable technical and organizational safeguards including:

### Access Controls
- Role-based permissions
- Authentication controls
- Session management

### Infrastructure Security
- Secure cloud hosting
- Encrypted data transmission
- Firewall protections
- Monitoring and logging

### Operational Security
- Access restriction policies
- Incident response procedures
- Backup and recovery processes

While iTrova implements reasonable safeguards, no system can guarantee absolute security.

## 7. Subprocessors

The Customer authorizes iTrova to engage trusted subprocessors necessary to operate the platform. Examples may include:
- Cloud hosting providers
- Authentication providers
- Email delivery services
- Payment processors
- Analytics services

iTrova shall take reasonable steps to ensure subprocessors maintain appropriate security standards.

## 8. International Data Transfers

Customer Data may be processed in jurisdictions outside Nigeria where cloud infrastructure providers operate. Where international transfers occur, iTrova will take reasonable measures to ensure adequate protection of Customer Data.

## 9. Data Subject Requests

Where applicable, iTrova shall provide reasonable assistance to Customers responding to requests relating to:
- Access
- Correction
- Deletion
- Portability
- Restriction of processing

The Customer remains primarily responsible for responding to such requests.

## 10. Security Incident Notification

In the event of a confirmed security incident affecting Customer Data, iTrova shall:
- Investigate the incident
- Take reasonable steps to mitigate risks
- Notify affected Customers without undue delay where required by law
- Provide available information regarding the nature and impact of the incident

Notification does not constitute an admission of fault or liability.

## 11. Data Retention and Deletion

Customer Data shall be retained during the active subscription period. Upon account termination:
- Customers may request export of their data
- Certain records may be retained for legal, security, audit, billing, or backup purposes
- Data will be deleted according to iTrova's retention policies and applicable legal requirements

## 12. Audit Rights

Upon reasonable written request and no more than once annually, Customers may request information regarding iTrova's security and privacy controls. iTrova may satisfy such requests through:
- Security questionnaires
- Compliance documentation
- Policy reviews

Requests must not compromise platform security or other customers' confidentiality.

## 13. Confidentiality

Both parties agree to maintain the confidentiality of all non-public information exchanged under this Agreement. Confidential information shall not be disclosed except:
- With written consent
- To authorized personnel with a legitimate need to know
- Where required by law

## 14. Limitation of Liability

Liability under this DPA shall be subject to the limitations contained within the iTrova Terms of Service. Nothing in this DPA expands either party's liability beyond those agreed limitations.

## 15. Term and Termination

This DPA shall remain in effect for as long as Customer Data is processed by iTrova. Termination of the underlying subscription agreement shall automatically terminate this DPA, except for provisions that survive termination by their nature.

## 16. Contact Information

Data Protection Contact  Allspire Technologies Limited  Email:  [hello@allspire.tech](mailto:hello@allspire.tech)  Questions regarding this DPA may be submitted to the above contact details.

  );
export default DataProcessingAgreement;$md$, '2026-06-06', true)
on conflict (slug, effective_at) do nothing;

notify pgrst, 'reload schema';
