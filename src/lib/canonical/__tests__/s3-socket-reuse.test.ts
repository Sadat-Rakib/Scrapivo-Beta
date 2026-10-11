import http from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const transport = vi.hoisted(() => ({ endpoint: "" }));
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...sdk, S3Client: class extends sdk.S3Client {
    constructor() {
      super({ region: "us-east-1", endpoint: transport.endpoint, forcePathStyle: true,
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
        requestHandler: new NodeHttpHandler({ httpAgent: agent }) });
    }
  } };
});
import { objectLength } from "../read-parquet.server";

let requests = 0;
const server = http.createServer((_request, response) => {
  requests++;
  response.writeHead(206, { "Content-Range": "bytes 0-0/100", "Content-Length": "1" });
  response.end("x");
});

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  transport.endpoint = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(async () => {
  agent.destroy();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it("repeated length probes consume real HTTP bodies and release a single pooled socket", async () => {
  for (let index = 0; index < 4; index++) {
    expect(await objectLength(`object-${index}`, { deadline: Date.now() + 1_000 })).toBe(100);
  }
  expect(requests).toBe(4);
});
