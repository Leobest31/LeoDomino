const fs = require("fs");

const inputFile = process.argv[2];
const outputFile = process.argv[3];

const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const b64 = data.result ? data.result.data : data.data;
fs.writeFileSync(outputFile, Buffer.from(b64, "base64"));
console.log("wrote", outputFile);
