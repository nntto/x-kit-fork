import { login, XAuthClient } from "./utils";
import axios from "axios";
import { Resvg } from '@resvg/resvg-js'
import dayjs from "dayjs";

const { client, legacy } = await login(process.env.AUTH_TOKEN!);

const title = "玛格丽特·米切尔 《飘》"
const description = `1. 过去的已经过去了，死了的已经死了，活着的还要继续活着。
2. 所有随风而逝的都是属于昨天的，所有历经风雨留下来的才是面向未来的。
3. 我从来不是那样的人，不能耐心地拾起一地碎片，把它们凑合在一起，然后对自己说，这个修补好了的东西，跟新的完全一样。
一样东西破碎了就是破碎了，我宁愿记住它最好时的模样，而不想把它修补好，然后终生看着那些碎了的地方。
4. 生活没有义务满足我们的期望，我们应该接受现实并因情况不是更糟而感恩。`;
const data = { title, description }

const svgResp = await axios.get(`https://apicards.io/api/image/mj?data=${encodeURIComponent(JSON.stringify(data))}`)
const svgBuffer = Buffer.from(svgResp.data, "binary");
const resvg = new Resvg(svgBuffer);
const pngBuffer = resvg.render().asPng();

const mediaResp = await legacy.v1.uploadMedia(pngBuffer, {
  mimeType: "image/png",
});

const resp = await client.getPostApi().postCreateTweet({
  tweetText: `${dayjs().format("YYYY-MM-DD")} 《飘》`,
  mediaIds: [mediaResp],
});

console.log(JSON.stringify(resp, null, 2))
