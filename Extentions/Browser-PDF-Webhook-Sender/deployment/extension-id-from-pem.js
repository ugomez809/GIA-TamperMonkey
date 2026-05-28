const crypto = require("crypto");
const fs = require("fs");

const pemPath = process.argv[2];

if (!pemPath) {
  console.error("Usage: node extension-id-from-pem.js <private-key.pem>");
  process.exit(1);
}

const pem = fs.readFileSync(pemPath);
const privateKey = crypto.createPrivateKey(pem);
const publicKey = crypto.createPublicKey(privateKey);
const publicKeyDer = publicKey.export({
  type: "spki",
  format: "der"
});
const hash = crypto.createHash("sha256").update(publicKeyDer).digest();
const alphabet = "abcdefghijklmnop";
let extensionId = "";

for (const byte of hash.subarray(0, 16)) {
  extensionId += alphabet[byte >> 4];
  extensionId += alphabet[byte & 0x0f];
}

console.log(extensionId);
