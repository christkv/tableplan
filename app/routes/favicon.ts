export function loader() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/favicon.svg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
