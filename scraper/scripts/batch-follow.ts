import fs from "fs-extra";
import { XAuthClient, xGuestClient } from "./utils";
import { get } from "lodash";
const accounts = fs.readdirSync("./accounts");

const client = await XAuthClient();

for (const account of accounts) {
  const accountData = fs.readFileSync(`./accounts/${account}`, "utf-8");
  const restId = get(JSON.parse(accountData), "restId", "");
  console.log("🚀 ~ restId:", restId);
  if (!restId) {
    console.log(`${account} rest_id is empty`);
    continue;
  }
  await client.getV11PostApi().postCreateFriendships({
    userId: restId,
  });

  await new Promise((resolve) => setTimeout(resolve, 1000 * 10));

  console.log(`${account} followed`);
}
