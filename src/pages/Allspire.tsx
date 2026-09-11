import { useState, type KeyboardEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { CollectionConfig, CollectionTab } from "@/components/cms/CollectionTab";
import { useAuth } from "@/contexts/AuthContext";
import { slugify } from "@/lib/allspire";
import { cn } from "@/lib/utils";

// Allspire website content. Every section on allspire.tech that shows proof (logos, numbers,
// stories, quotes, people) is fed from here and stays hidden on the site until something is
// published. Separate from the iTrova Website console by design.

const INDUSTRIES = ["real-estate", "finance", "retail", "logistics", "education"];

const LEGAL_SLUGS = ["terms", "privacy", "dpa"];

const COLLECTIONS: CollectionConfig[] = [
  {
    table: "as_logo",
    title: "Client logos",
    blurb: "Logos shown in the home page trust strip. Greyscale on the site; upload the colour version.",
    columns: ["logo_url", "name", "website", "sort", "published"],
    fields: [
      { key: "name", label: "Client name", type: "text", required: true },
      { key: "logo_url", label: "Logo", type: "image", required: true, folder: "logos", hint: "SVG or PNG with transparent background" },
      { key: "website", label: "Website", type: "text" },
      { key: "sort", label: "Sort", type: "number" },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_stat",
    title: "Stats",
    blurb: "The numbers strip under the hero. Only real figures: the strip hides until one is published.",
    columns: ["value", "label", "sort", "published"],
    fields: [
      { key: "value", label: "Value", type: "text", required: true, hint: "e.g. 12 or 4+" },
      { key: "label", label: "Label", type: "text", required: true, hint: "e.g. Projects delivered" },
      { key: "sort", label: "Sort", type: "number" },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_case_study",
    title: "Case studies",
    blurb: "Project stories for the home page, industry pages and /work. Summary is the card text; the body is the full story in markdown.",
    columns: ["title", "client", "industry", "published"],
    wide: true,
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true, hint: "allspire.tech/work/…", deriveFrom: { key: "title", fn: slugify } },
      { key: "client", label: "Client", type: "text" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES },
      { key: "summary", label: "Summary", type: "textarea", required: true, hint: "one or two sentences for the card" },
      { key: "challenge", label: "Challenge", type: "textarea" },
      { key: "solution", label: "Solution", type: "textarea" },
      { key: "outcome", label: "Outcome", type: "textarea", hint: "the result, ideally with a number" },
      { key: "cover_url", label: "Cover image", type: "image", folder: "case-studies" },
      { key: "body_md", label: "Full story (markdown)", type: "markdown" },
      { key: "sort", label: "Sort", type: "number" },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_testimonial",
    title: "Testimonials",
    blurb: "Real client quotes with a name and company. The section hides until one is published.",
    columns: ["name", "company", "quote", "published"],
    fields: [
      { key: "quote", label: "Quote", type: "textarea", required: true, hint: "their words, verbatim" },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "role", label: "Role", type: "text" },
      { key: "company", label: "Company", type: "text" },
      { key: "photo_url", label: "Photo", type: "image", folder: "testimonials" },
      { key: "sort", label: "Sort", type: "number" },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_team_member",
    title: "Team",
    blurb: "People on the About page.",
    columns: ["photo_url", "name", "role", "sort", "published"],
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "role", label: "Role", type: "text", required: true },
      { key: "bio", label: "One-line bio", type: "textarea" },
      { key: "photo_url", label: "Photo", type: "image", folder: "team" },
      { key: "linkedin", label: "LinkedIn URL", type: "text" },
      { key: "sort", label: "Sort", type: "number" },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_copy",
    title: "Page copy",
    blurb: "Keyed copy slots the site reads (mission, vision, story milestones, hero lines). Missing keys fall back to the copy built into the site.",
    columns: ["key", "value", "published"],
    pk: "key",
    orderBy: ["key"],
    rowLabel: (r) => String(r.key),
    fields: [
      { key: "key", label: "Key", type: "text", required: true, hint: "e.g. mission, vision, hero_headline" },
      { key: "value", label: "Value (JSON)", type: "json", required: true, hint: 'a string like "..." or an object' },
      { key: "published", label: "Published", type: "boolean" },
    ],
  },
  {
    table: "as_webinar",
    title: "Webinar",
    blurb: "The masterclass programme shown on /webinar and in the home page promo.",
    columns: [],
    pk: "id",
    singleton: true,
    orderBy: ["updated_at"],
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "schedule", label: "Schedule", type: "text", required: true, hint: "e.g. Every Saturday in 2026" },
      { key: "time_label", label: "Time", type: "text", required: true, hint: "e.g. 7:00 PM WAT" },
      { key: "registration_url", label: "Registration link", type: "text", hint: "Google Form or similar" },
      { key: "facilitator_name", label: "Facilitator name", type: "text" },
      { key: "facilitator_role", label: "Facilitator role", type: "text" },
      { key: "facilitator_photo_url", label: "Facilitator photo", type: "image", folder: "webinar" },
      { key: "topics", label: "Upcoming topics (JSON array of strings)", type: "json" },
      { key: "published", label: "Published (show the promo on the site)", type: "boolean" },
    ],
  },
];

// Versioned like the iTrova legal docs: the site shows the latest published row whose effective
// date has passed. Appended last so the proof collections keep their order.
COLLECTIONS.push({
  table: "as_legal_doc",
  title: "Legal",
  blurb: "Terms, Privacy and DPA on allspire.tech. Add a new row for a new version and set its effective date; the site shows the latest published version that is in effect.",
  columns: ["slug", "title", "effective_at", "published"],
  orderBy: ["slug", "effective_at"],
  wide: true,
  rowLabel: (r) => `${String(r.title)} (${String(r.effective_at)})`,
  fields: [
    { key: "slug", label: "Document", type: "select", required: true, options: LEGAL_SLUGS },
    { key: "title", label: "Title", type: "text", required: true, hint: "e.g. Terms of Service" },
    { key: "effective_at", label: "Effective date", type: "text", required: true, hint: "YYYY-MM-DD" },
    { key: "body_md", label: "Body (markdown)", type: "markdown", required: true },
    { key: "published", label: "Published", type: "boolean" },
  ],
});

export default function Allspire() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<string>(COLLECTIONS[0].table);
  const current = COLLECTIONS.find((c) => c.table === tab) ?? COLLECTIONS[0];

  // Roving focus per the ARIA tabs pattern: arrows, Home and End move between tabs and select them.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = COLLECTIONS.findIndex((c) => c.table === tab);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % COLLECTIONS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + COLLECTIONS.length) % COLLECTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = COLLECTIONS.length - 1;
    else return;
    e.preventDefault();
    const table = COLLECTIONS[next].table;
    setTab(table);
    document.getElementById(`as-tab-${table}`)?.focus();
  };

  return (
    <div>
      <PageHeader title="Allspire website" subtitle="Proof and copy on allspire.tech. Only published rows are visible to the public." />
      <div role="tablist" aria-label="Allspire content sections" onKeyDown={onTabKeyDown} className="mb-6 flex flex-wrap gap-1 border-b border-border/60">
        {COLLECTIONS.map((c) => (
          <button
            key={c.table}
            id={`as-tab-${c.table}`}
            type="button"
            role="tab"
            aria-selected={tab === c.table}
            aria-controls={`as-panel-${c.table}`}
            tabIndex={tab === c.table ? 0 : -1}
            onClick={() => setTab(c.table)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === c.table ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {c.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`as-panel-${current.table}`} aria-labelledby={`as-tab-${current.table}`}>
        <CollectionTab key={current.table} config={current} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
