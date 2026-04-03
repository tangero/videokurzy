import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { LandingPage } from "../views/landing";

const landing = new Hono<{ Bindings: Env; Variables: Variables }>();

landing.get("/", (c) => {
  const user = c.get("user");
  return c.html(<LandingPage user={user} />);
});

export { landing as landingRoutes };
