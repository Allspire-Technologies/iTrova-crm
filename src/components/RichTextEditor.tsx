import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";

function ToolButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the editor focused
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 place-items-center rounded transition-colors",
        active ? "bg-brand-light text-brand-dark" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Small WYSIWYG editor for email bodies (TipTap). Non-technical staff write formatted text
 * (bold/italic/lists); the value in/out is clean HTML, so {{merge}} tokens typed as plain text
 * keep working and the send path is unchanged.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": ariaLabel,
        class: "tiptap-content min-h-[96px] px-3 py-2 text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Adopt external value changes (e.g. a template being picked) without echoing an onUpdate.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return <div className={cn("min-h-[132px] rounded-md border border-input bg-background", className)} />;

  return (
    <div className={cn("rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring", className)}>
      <div className="flex items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-3.5" />
        </ToolButton>
        <ToolButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-3.5" />
        </ToolButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
