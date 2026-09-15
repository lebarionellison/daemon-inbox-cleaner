export default {
  async fetch(request) {
    return new Response("Daemon Inbox Cleaner API", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
