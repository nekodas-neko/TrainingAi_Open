import { auth } from "@/auth";
import { YearReviewContent } from "./year-review-content";

export default async function YearReviewPage() {
  const session = await auth();
  return <YearReviewContent userId={session?.user?.id} />;
}
