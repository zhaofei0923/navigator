import Link from "next/link";

export function SectionTabs({
  active,
  items,
}: {
  active: string;
  items: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <nav className="section-tabs" aria-label="页面分类">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
