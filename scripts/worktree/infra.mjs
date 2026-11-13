import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { common, databasePort, docker, owned, resourceName } from "./state.mjs";

export function stopInfra(value, removeVolume = false) {
  docker("info", "--format", "{{.ServerVersion}}");
  if (owned("container", value))
    docker("container", "rm", "-f", resourceName(value));
  if (owned("network", value)) docker("network", "rm", resourceName(value));
  if (removeVolume && owned("volume", value))
    docker("volume", "rm", resourceName(value));
}
async function hostReady(port) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
export async function startInfra(value) {
  docker("info", "--format", "{{.ServerVersion}}");
  const name = resourceName(value);
  const labels = [
    "--label",
    `hero.worktree=${value.id}`,
    "--label",
    `hero.repository=${common}`,
  ];
  if (!owned("volume", value)) docker("volume", "create", ...labels, name);
  if (!owned("container", value)) {
    try {
      docker(
        "container",
        "create",
        "--name",
        name,
        ...labels,
        "-e",
        "POSTGRES_USER=hero_test",
        "-e",
        "POSTGRES_PASSWORD=hero_test",
        "-e",
        "POSTGRES_DB=hero_test",
        "-p",
        `127.0.0.1:${databasePort(value)}:5432`,
        "-v",
        `${name}:/var/lib/postgresql/data`,
        "postgres:17.6-alpine",
      );
    } catch {
      throw Error(
        `Cannot create ${name}; check Docker and port ${databasePort(value)}. Allocation retained.`,
      );
    }
  }
  // Verify mounts and port mapping too: a labelled but modified container must not escape isolation.
  const container = JSON.parse(docker("container", "inspect", name))[0];
  const binding = container.HostConfig.PortBindings?.["5432/tcp"];
  if (
    binding?.length !== 1 ||
    binding[0].HostIp !== "127.0.0.1" ||
    binding[0].HostPort !== String(databasePort(value)) ||
    !container.Mounts.some(
      (mount) =>
        mount.Name === name && mount.Destination === "/var/lib/postgresql/data",
    )
  ) {
    throw Error(
      "Owned container has unexpected isolation settings; refusing start.",
    );
  }
  try {
    docker("container", "start", name);
  } catch {
    throw Error(
      `Cannot start ${name}; check port ${databasePort(value)} for a bind conflict. Allocation retained.`,
    );
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker("exec", name, "pg_isready", "-U", "hero_test", "-d", "hero_test");
      if (!(await hostReady(databasePort(value))))
        throw Error("Host port is not reachable.");
      console.log(`PostgreSQL ready on port ${databasePort(value)} (${name}).`);
      return;
    } catch {
      await delay(500);
    }
  }
  throw Error(`PostgreSQL readiness timed out for ${name}.`);
}
