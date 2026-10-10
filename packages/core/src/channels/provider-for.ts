import { SimulatorProvider } from "./simulator.ts";
import type { ChannelProvider, ChannelType } from "./types.ts";

export function providerFor(type: ChannelType): ChannelProvider {
  if (type === "simulator") return new SimulatorProvider();
  throw new Error("Canal ainda não disponível.");
}
