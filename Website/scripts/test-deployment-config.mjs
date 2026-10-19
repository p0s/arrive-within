import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deploymentEnvironment, parseDeploymentConfig, parsePublisherArguments, readDeploymentConfig } from "./deployment-config.mjs";

const publicBinding = { workerName: "arrivewithin-web", customDomains: ["arrivewithin.com", "www.arrivewithin.com"] };
const fixture = () => ({ schemaVersion: 1, profile: ["synthetic", "deployment"].join("-"), accountId: "a".repeat(32), ...publicBinding });

test("private binding requires exact project, valid account, profile and schema", () => {
  const value = fixture();
  assert.deepEqual(parseDeploymentConfig(value, publicBinding), value);
  assert.deepEqual(parseDeploymentConfig(value, publicBinding, value.profile), value);
  assert.ok(Object.isFrozen(parseDeploymentConfig(value, publicBinding).customDomains));
  for (const invalid of [null, [], {}, { ...value, extra: true }, { ...value, schemaVersion: 2 },
    { ...value, accountId: "bad" }, { ...value, profile: "--other".repeat(20) },
    { ...value, profile: "bad profile" }, { ...value, workerName: "another-worker" },
    { ...value, customDomains: ["example.test"] }]) {
    assert.throws(() => parseDeploymentConfig(invalid, publicBinding));
  }
  assert.throws(() => parseDeploymentConfig(value, publicBinding, "different"));
  assert.equal(deploymentEnvironment(value, { CLOUDFLARE_ACCOUNT_ID: "wrong", KEEP: "yes" }).CLOUDFLARE_ACCOUNT_ID, value.accountId);
  assert.equal(deploymentEnvironment(value, { KEEP: "yes" }).KEEP, "yes");
});

test("publisher modes are exclusive and a profile override is explicit", () => {
  assert.deepEqual(parsePublisherArguments([]), { profile: undefined, mode: "publish" });
  for (const mode of ["retry-indexnow", "deploy-only", "check-config"]) {
    assert.equal(parsePublisherArguments([`--${mode}`]).mode, mode);
    assert.equal(parsePublisherArguments(["--profile", fixture().profile, `--${mode}`]).profile, fixture().profile);
  }
  for (const invalid of [["--profile"], ["unknown"], ["--deploy-only", "--retry-indexnow"],
    ["--check-config", "--check-config"], ["--profile", "one", "--profile", "two"]]) {
    assert.throws(() => parsePublisherArguments(invalid));
  }
});

test("private loader accepts only owner-only files outside source and sanitizes errors", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "deployment-config-test-"));
  try {
    const repositoryRoot = path.join(temp, "repo");
    await mkdir(repositoryRoot);
    const configPath = path.join(temp, "binding.json");
    await writeFile(configPath, JSON.stringify(fixture()), { mode: 0o600 });
    const options = { repositoryRoot, publicBinding, configPath };
    assert.deepEqual(await readDeploymentConfig(options), fixture());
    const reject = async (overrides = {}) => assert.rejects(readDeploymentConfig({ ...options, ...overrides }), (error) => {
      assert.equal(error.message, "Private deployment binding must be a valid owner-only file outside the repository");
      assert.ok(!error.message.includes(temp));
      assert.ok(!error.message.includes(fixture().profile));
      return true;
    });
    await reject({ requestedProfile: "different" });
    await reject({ configPath: "relative.json" });
    await reject({ configPath: path.join(temp, "missing.json") });
    await chmod(configPath, 0o644);
    await reject();
    await chmod(configPath, 0o600);
    const linked = path.join(temp, "linked.json");
    await symlink(configPath, linked);
    await reject({ configPath: linked });
    const inside = path.join(repositoryRoot, "binding.json");
    await writeFile(inside, JSON.stringify(fixture()), { mode: 0o600 });
    await reject({ configPath: inside });
    await writeFile(configPath, "x".repeat(4097));
    await reject();
    await writeFile(configPath, "invalid private content");
    await reject();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
