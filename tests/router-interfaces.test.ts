import { describe, expect, it } from "vitest";
import { buildInterfaceAgentLines } from "../src/lib/router-interfaces";

const URL = "https://app.example.com/api/public/router/interfaces/abc123_TOKEN-x";

describe("buildInterfaceAgentLines", () => {
  it("only accepts the platform interface-report endpoint", () => {
    expect(buildInterfaceAgentLines(URL)).toHaveLength(4);
    expect(
      buildInterfaceAgentLines("http://app.example.com/api/public/router/interfaces/token"),
    ).toEqual([]);
    expect(
      buildInterfaceAgentLines(
        "https://app.example.com/api/public/router/interfaces/x; /system reset",
      ),
    ).toEqual([]);
  });

  it("installs a one-minute interface reporter that posts RouterOS counters", () => {
    const lines = buildInterfaceAgentLines(URL);
    const script = lines.find((line) => line.includes("add name=netgrid-ifaces"))!;
    expect(script).toContain(URL);
    expect(script).toContain('($x->"rx-byte")');
    expect(script).toContain("http-method=post http-data=$d");
    expect(lines[3]).toContain("interval=1m");
  });
});
