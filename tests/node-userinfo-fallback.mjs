import os from "node:os";

try {
  os.userInfo();
} catch (error) {
  if (error?.info?.syscall !== "uv_os_get_passwd") throw error;
  os.userInfo = () => ({
    username: process.env.USERNAME || "local-user",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: os.homedir(),
  });
}
