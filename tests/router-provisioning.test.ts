import { describe, expect, it } from "vitest";
import { mikrotikProvisionCommand } from "../src/lib/router-provisioning";

describe("MikroTik provisioning command", () => {
  it("imports the downloaded file directly instead of wrapping import in :execute", () => {
    const command = mikrotikProvisionCommand("https://app.example.com", "bootstrap-token");

    expect(command).toContain(
      '/tool fetch url="https://app.example.com/api/public/provision/bootstrap-token/router.rsc" mode=https dst-path=auto-config.rsc',
    );
    expect(command).toContain("; :delay 1s; /import file-name=auto-config.rsc");
    expect(command).not.toContain(":execute");
  });
});
