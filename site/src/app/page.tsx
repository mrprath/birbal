import { getBlogPosts } from "@/lib/content";
import { Landing } from "./landing";

export default function Home() {
  const posts = getBlogPosts().slice(0, 4);
  return <Landing posts={posts} />;
}
