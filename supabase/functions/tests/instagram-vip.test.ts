import { processInstagramVipWork, type VipDeps } from "../instagram-worker/vip.ts";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
function fixture() {
 const posts: string[] = []; const results: { state: string; errorCode: string | null }[] = [];
 const deps: VipDeps = {
  prepareVip: async () => ({ eventId: "ev", organizationId: "org", channelId: "ch", connectionId: "conn", commentId: "123", mediaId: "456", senderExternalId: "900", activatedAt: "2026-10-10T00:00:00Z", operations: [{ id: "public", kind: "public", state: "pending" },{ id: "private", kind: "private", state: "pending" }] }),
  claimVip: async (id) => ({ id, claimToken: "claim", kind: id as "public" | "private", text: "Convite" }),
  completeVip: async (_id, _token, state, _external, errorCode) => { results.push({state,errorCode}); },
  finishVipWork: async () => {},
  readConnectionSecrets: async () => ({ connectionId: "conn", organizationId: "org", appId: "app", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "secret", verifyToken: "verify", channels: [{ channelId: "ch", accountId: "789", username: "empresa", status: "active", accessToken: "token" }] }),
  now: () => new Date("2026-10-12T12:00:00Z"),
  fetch: async (url, init) => {
    const path=String(url);
    if (init?.method === "POST") { posts.push(path); return path.endsWith("/replies") ? Response.json({id:"reply"}) : Response.json({message_id:"dm",recipient_id:"900"}); }
    if (path.includes("/me?")) return Response.json({user_id:"789",username:"empresa"});
    if (path.includes("/123?")) return Response.json({id:"123",timestamp:"2026-10-11T12:00:00Z",text:"Quero ViP!",from:{id:"900",username:"cliente"},media:{id:"456"}});
    return Response.json({id:"456",owner:{id:"789",username:"empresa"}});
  },
 };
 return { deps, posts, results };
}
const item={queueId:1,eventId:"ev",task:"vip" as const};
Deno.test("VIP independently sends one public and requested private reply",async()=>{const f=fixture();assert(await processInstagramVipWork(item,f.deps)==="done");assert(f.posts.length===2);});
Deno.test("VIPER produces public reply only",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).includes("/123?")?Response.json({id:"123",timestamp:"2026-10-11T12:00:00Z",text:"VIPER",from:{id:"900",username:"cliente"},media:{id:"456"}}):fetcher(url,init);await processInstagramVipWork(item,f.deps);assert(f.posts.length===1&&f.posts[0].endsWith("/replies"));});
Deno.test("own verified username ignores app scoped ID mismatch",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).includes("/123?")?Response.json({id:"123",timestamp:"2026-10-11T12:00:00Z",text:"VIP",from:{id:"900",username:"EMPRESA"},media:{id:"456"}}):fetcher(url,init);assert(await processInstagramVipWork(item,f.deps)==="ignored");assert(f.posts.length===0);});
Deno.test("ambiguous author is ignored",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).includes("/123?")?Response.json({id:"123",timestamp:"2026-10-11T12:00:00Z",text:"VIP",from:{id:"900"},media:{id:"456"}}):fetcher(url,init);assert(await processInstagramVipWork(item,f.deps)==="ignored");assert(f.posts.length===0);});
Deno.test("foreign media never gets replies",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).includes("/456?")?Response.json({id:"456",owner:{id:"other",username:"other"}}):fetcher(url,init);assert(await processInstagramVipWork(item,f.deps)==="ignored");assert(f.posts.length===0);});
Deno.test("public timeout does not prevent private operation",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>{if(String(url).endsWith("/replies"))throw new Error("timeout");return fetcher(url,init);};assert(await processInstagramVipWork(item,f.deps)==="uncertain");assert(f.posts.length===1&&f.posts[0].endsWith("/messages"));assert(f.results.some(r=>r.state==="uncertain"));});
Deno.test("already sent operation is not posted again when private retries",async()=>{const f=fixture();const prepare=f.deps.prepareVip;f.deps.prepareVip=async(id)=>{const p=await prepare(id);if(p)p.operations[0].state="sent";return p;};await processInstagramVipWork(item,f.deps);assert(f.posts.length===1&&f.posts[0].endsWith("/messages"));});
Deno.test("pause before claim produces no POST",async()=>{const f=fixture();f.deps.claimVip=async()=>null;await processInstagramVipWork(item,f.deps);assert(f.posts.length===0);});
Deno.test("429 remains retryable independently",async()=>{const f=fixture();const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).endsWith("/replies")?Response.json({error:{code:4}},{status:429}):fetcher(url,init);assert(await processInstagramVipWork(item,f.deps)==="retry");assert(f.results.some(r=>r.state==="pending"&&r.errorCode==="rate_limited"));assert(f.results.some(r=>r.state==="sent"));});
Deno.test("VIP task dispatch does not touch existing automation prepare or acknowledgement",async()=>{
 const {processInstagramWork}=await import("../instagram-worker/handler.ts");const f=fixture();
 const deps={...f.deps,prepare:async()=>{throw new Error("legacy prepare called");},finishWork:async()=>{throw new Error("legacy acknowledgement called");}};
 assert(await processInstagramWork(item,deps as unknown as import("../instagram-worker/handler.ts").InstagramWorkerDeps)==="done");assert(f.posts.length===2);
});
Deno.test("old comments never receive private replies even when public is eligible",async()=>{
 const f=fixture();const prepare=f.deps.prepareVip;f.deps.prepareVip=async(id)=>{const p=await prepare(id);if(p)p.activatedAt="2026-10-01T00:00:00Z";return p;};const fetcher=f.deps.fetch;f.deps.fetch=async(url,init)=>String(url).includes("/123?")?Response.json({id:"123",timestamp:"2026-10-02T12:00:00Z",text:"VIP",from:{id:"900",username:"cliente"},media:{id:"456"}}):fetcher(url,init);await processInstagramVipWork(item,f.deps);assert(f.posts.length===1&&f.posts[0].endsWith("/replies"));
});
Deno.test("foreign tenant secrets never issue provider requests",async()=>{
 const f=fixture();const read=f.deps.readConnectionSecrets;f.deps.readConnectionSecrets=async(id)=>{const s=await read(id);if(s)s.organizationId="other";return s;};f.deps.fetch=async()=>{throw new Error("must not fetch");};assert(await processInstagramVipWork(item,f.deps)==="ignored");
});
Deno.test("VIP reservations and acknowledgements bind the credentials used for metadata and send",async()=>{
 const f=fixture();const claims:unknown[][]=[];const finishes:unknown[][]=[];const claim=f.deps.claimVip;
 f.deps.claimVip=async(...args)=>{claims.push(args);return claim(...args);};
 f.deps.finishVipWork=async(...args)=>{finishes.push(args);};
 await processInstagramVipWork(item,f.deps);
 assert(claims.length===2&&claims.every(args=>args[3]==="conn"&&args[4]===1),"reservation must carry exact connection and credential generation");
 assert(finishes[0][3]==="conn"&&finishes[0][4]===1,"error acknowledgement must identify the credential snapshot");
});
