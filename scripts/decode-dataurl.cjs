const fs = require("fs");

const dataUrl = fs.readFileSync(process.argv[2], "utf8").trim();
const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
fs.writeFileSync(process.argv[3], Buffer.from(b64, "base64"));
console.log("wrote", process.argv[3]);
