const http = require("node:http");
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/apps/web/package.json");
const next = req("next");
const app = next({
  dev: false,
  dir: process.cwd() + "/apps/web",
  hostname: "127.0.0.1",
  port: 3078,
});
(async () => {
  await app.prepare();
  const handle = app.getRequestHandler();
  http
    .createServer(async (request, response) => {
      if (
        [
          "/synthetic-static-failure",
          "/settings/synthetic-server-failure",
          "/settings/account",
        ].includes(request.url)
      ) {
        response.statusCode = 500;
        const source =
          request.url === "/settings/account" ? "/login" : "/does-not-exist";
        const r = await fetch("http://127.0.0.1:3076" + source, {
          method: "HEAD",
        });
        const policy = r.headers.get("content-security-policy");
        if (!policy) throw Error("Missing source CSP");
        request.headers["content-security-policy"] = policy;
        response.setHeader("Content-Security-Policy", policy);
        return app.renderError(null, request, response, request.url);
      }
      return handle(request, response);
    })
    .listen(3078, "127.0.0.1", () =>
      console.log(JSON.stringify({ staticFixtureReady: true, port: 3078 })),
    );
})().catch((e) => console.log(JSON.stringify({ error: e.name })));
