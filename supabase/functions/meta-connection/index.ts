import { createAuthorize } from "../_shared/auth.ts";
import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleMetaConnection } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
Deno.serve((request) => handleMetaConnection(request, {
  authorize: createAuthorize(url, anonKey, fetch), repository: createMetaRepository(url, serviceKey, fetch), fetch,
}));
