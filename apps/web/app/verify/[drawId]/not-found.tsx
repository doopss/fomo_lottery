import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-3xl">Draw not found</h1>
      <Link href="/winners" className="text-sm text-accent">
        Back to winners
      </Link>
    </div>
  );
}
