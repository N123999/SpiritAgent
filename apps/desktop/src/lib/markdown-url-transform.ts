import { defaultUrlTransform } from "react-markdown";
import type { UrlTransform as ReactMarkdownUrlTransform } from "react-markdown";
import { defaultUrlTransform as streamdownDefaultUrlTransform } from "streamdown";
import type { UrlTransform as StreamdownUrlTransform } from "streamdown";

import { isManagedGeneratedImageRef } from "@/lib/managed-generated-image";

export const reactMarkdownUrlTransform: ReactMarkdownUrlTransform = (url, key, node) => {
  if (node.tagName === "img" && isManagedGeneratedImageRef(url)) {
    return url;
  }
  return defaultUrlTransform(url);
};

export const streamdownUrlTransform: StreamdownUrlTransform = (url, key) => {
  if (key === "src" && isManagedGeneratedImageRef(url)) {
    return url;
  }
  return streamdownDefaultUrlTransform(url, key, {} as never);
};
