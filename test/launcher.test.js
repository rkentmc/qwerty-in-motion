// Checks that the study's phrases and Monkeytype links in index.html are intact.
//
// Run from the repo folder with:   node --test
// Needs Node.js 18 or newer. Nothing to install.
//
// Two checks, each run for all 21 runs (3 practice, 9 warm-ups, 9 tests):
//   1. The phrases and link are exactly the ones frozen in expected-data.json.
//   2. The link, once decoded, holds the same words as the phrases beside it,
//      in the same order, and ends after the last word.
//
// If a phrase or link is ever changed on purpose, expected-data.json must be
// changed to match in the same pull request, so a reviewer sees both.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "expected-data.json"), "utf8"));

function readPageData() {
  const found = page.match(/const DATA\s*=\s*(\{.*\});/);
  assert.ok(found, "Could not find the line starting `const DATA = {` in index.html");
  return JSON.parse(found[1]);
}

// Flattens practice runs and rounds into one named list, in page order.
function listRuns(data) {
  const runs = [];
  data.practice.forEach((run, i) => runs.push({ name: `Practice ${i + 1}`, run }));
  data.rounds.forEach((round, i) => {
    runs.push({ name: `Round ${i + 1} warm-up`, run: round.warmup });
    runs.push({ name: `Round ${i + 1} test`, run: round.test });
  });
  return runs;
}

// Monkeytype packs a test's settings into the link with the LZ-string
// "encoded URI component" format. This unpacks it back into text.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
function unpack(input) {
  let position = 32;
  let index = 1;
  let value = ALPHABET.indexOf(input[0]);
  const readBits = (count) => {
    let bits = 0;
    for (let power = 0; power < count; power++) {
      const bit = value & position;
      position >>= 1;
      if (position === 0) {
        position = 32;
        value = ALPHABET.indexOf(input[index++]);
      }
      if (bit) bits |= 1 << power;
    }
    return bits;
  };

  const dictionary = [0, 1, 2];
  let enlargeIn = 4;
  let numBits = 3;
  const first = readBits(2);
  if (first === 2) return "";
  let previous = String.fromCharCode(readBits(first === 0 ? 8 : 16));
  dictionary.push(previous);
  const result = [previous];

  for (;;) {
    if (index > input.length) throw new Error("link data ended early");
    let code = readBits(numBits);
    if (code === 2) return result.join("");
    if (code === 0 || code === 1) {
      dictionary.push(String.fromCharCode(readBits(code === 0 ? 8 : 16)));
      code = dictionary.length - 1;
      enlargeIn--;
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry;
    if (code < dictionary.length) entry = dictionary[code];
    else if (code === dictionary.length) entry = previous + previous[0];
    else throw new Error("link data is damaged");
    result.push(entry);
    dictionary.push(previous + entry[0]);
    enlargeIn--;
    previous = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

// Returns what a Monkeytype link will load: its word list and how it is played.
function readLink(link) {
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://monkeytype.com/", "link does not point at monkeytype.com");
  const packed = url.searchParams.get("testSettings");
  assert.ok(packed, "link has no testSettings part");
  // A "+" in a link's query is read back as a space, so put it back.
  const settings = JSON.parse(unpack(packed.replace(/ /g, "+")));
  return { mode: settings[0], custom: settings[2] };
}

const data = readPageData();
const pageRuns = listRuns(data);
const expectedRuns = listRuns(expected);

test("the page has 3 practice runs and 9 rounds of 2 warm-up and 5 test phrases", () => {
  assert.equal(data.practice.length, 3, "number of practice runs");
  assert.equal(data.rounds.length, 9, "number of rounds");
  data.practice.forEach((run, i) => assert.equal(run.phrases.length, 1, `Practice ${i + 1} phrase count`));
  data.rounds.forEach((round, i) => {
    assert.equal(round.warmup.phrases.length, 2, `Round ${i + 1} warm-up phrase count`);
    assert.equal(round.test.phrases.length, 5, `Round ${i + 1} test phrase count`);
  });
});

test("no phrase or link has changed", async (t) => {
  assert.equal(pageRuns.length, expectedRuns.length, "number of runs");
  for (const [i, { name, run }] of pageRuns.entries()) {
    await t.test(name, () => {
      assert.deepEqual(run.phrases, expectedRuns[i].run.phrases, `${name}: phrases changed`);
      assert.equal(run.url, expectedRuns[i].run.url, `${name}: link changed`);
    });
  }
  // Catches anything added to or removed from DATA outside the runs above.
  assert.deepEqual(data, expected, "DATA in index.html no longer matches expected-data.json");
});

test("each link loads the phrases listed beside it", async (t) => {
  for (const { name, run } of pageRuns) {
    await t.test(name, () => {
      const words = run.phrases.join(" ").split(" ");
      const link = readLink(run.url);
      assert.equal(link.mode, "custom", `${name}: link is not a custom-text test`);
      assert.deepEqual(link.custom.text, words, `${name}: link loads different words from the phrases shown`);
      assert.equal(link.custom.mode, "repeat", `${name}: link does not keep the words in order`);
      assert.deepEqual(link.custom.limit, { mode: "word", value: words.length }, `${name}: link does not end after the last word`);
    });
  }
});
