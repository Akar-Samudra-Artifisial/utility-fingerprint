"use client";

import { useEffect, useState } from "react";
import { CheckIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CopyLinkButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const t = window.setTimeout(() => setStatus("idle"), status === "failed" ? 3200 : 1600);
    return () => window.clearTimeout(t);
  }, [status]);
  const copy = () => {
    // clipboard is missing on insecure origins and rejects without permission/focus
    if (!navigator.clipboard) {
      setStatus("failed");
      return;
    }
    navigator.clipboard.writeText(window.location.href).then(
      () => setStatus("copied"),
      () => setStatus("failed"),
    );
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} className={status === "failed" ? "text-destructive" : undefined}>
      {status === "copied" ? <CheckIcon /> : status === "failed" ? <TriangleAlertIcon /> : <LinkIcon />}
      <span aria-live="polite">
        {status === "copied" ? "Link copied" : status === "failed" ? "Copy failed, use the address bar" : "Copy link"}
      </span>
    </Button>
  );
}
