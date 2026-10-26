/* GitHub avatars come from an external host; a plain img is intentional (no image optimizer needed). */
/* eslint-disable @next/next/no-img-element */
export default function Avatar({ src, size }: { src: string; size: number }) {
  return <img src={src} alt="" width={size} height={size} className="rounded-full" />;
}
