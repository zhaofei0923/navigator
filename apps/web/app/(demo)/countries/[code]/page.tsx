import { CountryDetailView } from "@/components/country-detail-view";

export default async function CountryDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <CountryDetailView code={code.toUpperCase()} />;
}
