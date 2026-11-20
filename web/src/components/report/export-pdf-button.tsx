"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Opens the browser print dialog; the user picks "Save as PDF". */
export function ExportPdfButton({ title }: { title?: string }) {
  const print = () => {
    if (title) {
      // The browser proposes document.title as the PDF file name.
      const previous = document.title;
      document.title = title;
      window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    }
    window.print();
  };
  return (
    <Button variant="outline" size="sm" onClick={print}>
      <PrinterIcon />
      Export PDF
    </Button>
  );
}
