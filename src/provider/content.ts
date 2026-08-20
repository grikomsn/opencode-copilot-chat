export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export type ChatContent = string | ContentPart[];

export function chatContent(value: string, images: readonly ContentPart[]): ChatContent {
  return images.length
    ? [...(value ? [{ type: "text" as const, text: value }] : []), ...images]
    : value;
}
