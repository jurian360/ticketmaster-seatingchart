import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SeatPick — interactive seating charts",
  description:
    "A Ticketmaster-style seating chart demo: build a venue in the admin dashboard, then zoom in and pick seats under a no-single-seat rule.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-ink text-[#e6eaf1]">{children}</body>
    </html>
  );
}
