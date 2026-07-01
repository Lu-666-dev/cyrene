import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const workspaceRoot = process.cwd();
const tempDir = path.join(workspaceRoot, ".tmp", "action-flow-test");
const bundledModule = path.join(tempDir, "action-flow.mjs");

await mkdir(tempDir, { recursive: true });
await build({
  entryPoints: [path.join(workspaceRoot, "apps", "model-lab", "src", "ui", "action-flow.ts")],
  outfile: bundledModule,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent"
});

const {
  buildActionFlowStages,
  calculateFlowDuration,
  getParameterTargetsForAction,
  getResetParametersForAction,
  mapParameterToChannel
} = await import(pathToFileURL(bundledModule));

const durations = {
  happy: 1000,
  circle: 1200,
  star: 1300,
  shade: 900,
  body: 1600,
  ropeOn: 700,
  ropeOff: 800,
  question: 500,
  sparkle: 600,
  legacyQuestion: 500,
  smileMotion: 1600
};

const actionSet = {
  happy: action("happy", "Happy eyes", "self", "expression", ["parameter:Param3"]),
  circle: action("circle", "Circle eyes", "self", "expression", ["parameter:Param2"]),
  star: action("star", "Star eyes", "self", "expression", ["parameter:Param"]),
  shade: action("shade", "Shade", "self", "expression", ["parameter:Param4"]),
  body: action("body", "Body motion", "self", "motion", ["body:motion"]),
  ropeOn: action("ropeOn", "Rope on", "persistent", "expression", ["parameter:Param16"]),
  ropeOff: action("ropeOff", "Rope off", "persistent", "expression", ["parameter:Param16"]),
  question: action("question", "Question", "next", "expression", ["parameter:Param6"]),
  sparkle: action("sparkle", "Sparkle", "next", "expression", ["parameter:Param7"]),
  legacyQuestion: action("legacyQuestion", "Legacy question", undefined, "expression", ["region:question-effect"]),
  smileMotion: action("smileMotion", "Smile motion", "self", "motion", [
    "parameter:Param2",
    "parameter:Param3",
    "parameter:ParamEyeLOpen",
    "parameter:ParamEyeROpen",
    "parameter:ParamMouthForm",
    "parameter:ParamMouthOpenY",
    "parameter:ParamAngleX",
    "parameter:ParamBodyAngleZ"
  ])
};

const explicitCases = [
  ["empty", [], []],
  ["next before base", ["question", "happy"], ["question+happy"]],
  ["next between same region", ["happy", "question", "circle"], ["happy", "question+circle"]],
  ["next before repeated same region", ["happy", "circle", "question", "happy"], ["happy", "circle", "question+happy"]],
  ["next at tail", ["happy", "circle", "happy", "question"], ["happy", "circle", "happy", "question"]],
  ["consecutive next before base", ["question", "sparkle", "happy"], ["question+sparkle+happy"]],
  ["consecutive next between bases", ["happy", "question", "sparkle", "circle"], ["happy", "question+sparkle+circle"]],
  ["different regions parallel", ["happy", "shade", "body"], ["happy+shade+body"]],
  ["same region split", ["happy", "circle", "star"], ["happy", "circle", "star"]],
  ["motion touching eyes conflicts with star eyes", ["smileMotion", "star"], ["smileMotion", "star"]],
  ["star eyes conflicts with motion touching eyes", ["star", "smileMotion"], ["star", "smileMotion"]],
  ["same persistent channel split", ["ropeOn", "ropeOff"], ["ropeOn", "ropeOff"]],
  ["persistent plus unrelated base", ["ropeOn", "happy"], ["ropeOn+happy"]],
  ["legacy next channel still works", ["legacyQuestion", "happy"], ["legacyQuestion+happy"]]
];

const failures = [];

for (const [name, ids, expected] of explicitCases) {
  const actual = stageIds(ids.map((id) => actionSet[id]));
  assertEqual(actual, expected, `explicit: ${name}`);
}

const resetParameters = [
  { id: "Param", value: 0 },
  { id: "Param2", value: 0 },
  { id: "Param3", value: 0 },
  { id: "Param4", value: 0 },
  { id: "Param6", value: 0 },
  { id: "Param7", value: 0 },
  { id: "Param16", value: 0 },
  { id: "Param32", value: 0 }
];

const resetCases = [
  ["circle clears all eye parameters", actionSet.circle, ["Param", "Param2", "Param3"]],
  ["star clears all eye parameters", actionSet.star, ["Param", "Param2", "Param3"]],
  ["happy clears all eye parameters", actionSet.happy, ["Param", "Param2", "Param3"]],
  ["shade clears only accessory", actionSet.shade, ["Param4"]],
  ["question clears only question effect", actionSet.question, ["Param6"]],
  ["rope clears only rope switch", actionSet.ropeOn, ["Param16"]]
];

for (const [name, actionItem, expectedParameterIds] of resetCases) {
  const actualParameterIds = getResetParametersForAction(actionItem, resetParameters).map((parameter) => parameter.id);
  assertEqual(actualParameterIds, expectedParameterIds, `reset: ${name}`);
}

const actionParameters = Object.fromEntries(Object.values(actionSet).map((actionItem) => [
  actionItem.id,
  expressionTargetParameters(actionItem)
]));
const targetCases = [
  ["circle targets reset eye region plus circle", actionSet.circle, { Param: 0, Param2: 1, Param3: 0 }],
  ["star targets reset eye region plus star", actionSet.star, { Param: 1, Param2: 0, Param3: 0 }],
  ["happy targets reset eye region plus happy", actionSet.happy, { Param: 0, Param2: 0, Param3: 1 }],
  ["question targets only question effect", actionSet.question, { Param6: 1 }],
  ["sparkle targets only sparkle effect", actionSet.sparkle, { Param7: 1 }],
  ["rope targets only rope switch", actionSet.ropeOn, { Param16: 1 }]
];

for (const [name, actionItem, expectedTargets] of targetCases) {
  const actualTargets = Object.fromEntries(getParameterTargetsForAction(actionItem, resetParameters, actionParameters).map((parameter) => [
    parameter.id,
    parameter.value
  ]));
  assertEqual(actualTargets, expectedTargets, `targets: ${name}`);
}

const fixtureActions = [
  actionSet.happy,
  actionSet.circle,
  actionSet.shade,
  actionSet.smileMotion,
  actionSet.body,
  actionSet.ropeOn,
  actionSet.question,
  actionSet.sparkle
];

let exhaustiveCount = 0;
for (const sequence of enumerateSequences(fixtureActions, 5)) {
  exhaustiveCount += 1;
  const stages = buildActionFlowStages(sequence, durations);
  const expected = oracleBuildStages(sequence);

  assertEqual(stageIdsFromStages(stages), stageIdsFromStages(expected), `oracle sequence: ${sequence.map((item) => item.id).join(" -> ")}`);
  assertEqual(
    calculateFlowDuration(stages),
    expected.reduce((total, stage) => total + stage.durationMs, 0),
    `duration sequence: ${sequence.map((item) => item.id).join(" -> ")}`
  );
  assertFlowInvariants(sequence, stages);
}

const realActions = await loadGeneratedActions();
const realActionParameters = await loadRealActionParameters(realActions);
const realResetParameters = collectRealResetParameters(realActionParameters);
let realExpressionTargetCount = 0;
for (const actionItem of realActions) {
  if (actionItem.source !== "expression" || !realActionParameters[actionItem.id]?.length) {
    continue;
  }

  realExpressionTargetCount += 1;
  const targets = getParameterTargetsForAction(actionItem, realResetParameters, realActionParameters);
  const ownParameters = realActionParameters[actionItem.id] ?? [];
  for (const parameter of ownParameters) {
    const target = targets.find((candidate) => candidate.id === parameter.id);
    assertEqual(target?.value, parameter.value, `real targets include own parameter: ${actionItem.id}.${parameter.id}`);
  }
}

let realSequenceCount = 0;
for (const sequence of enumerateSequences(realActions, 3)) {
  realSequenceCount += 1;
  const realDurations = Object.fromEntries(realActions.map((item) => [item.id, item.source === "motion" ? 1600 : 1100]));
  const stages = buildActionFlowStages(sequence, realDurations);
  assertFlowInvariants(sequence, stages);
}

if (failures.length > 0) {
  console.error(`action-flow verification failed: ${failures.length} issue(s)`);
  for (const failure of failures.slice(0, 50)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 50) {
    console.error(`- ... ${failures.length - 50} more`);
  }
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    explicitCases: explicitCases.length,
    resetCases: resetCases.length,
    targetCases: targetCases.length,
    exhaustiveFixtureSequences: exhaustiveCount,
    realGeneratedActions: realActions.length,
    realExpressionTargetCount,
    realGeneratedSequences: realSequenceCount
  }, null, 2));
}

function action(id, label, scope, source, channelIds) {
  return {
    id,
    kind: scope === "persistent" ? "stateful" : "atomic",
    ...(scope === undefined ? {} : { scope }),
    label,
    source,
    sourceKey: id,
    channelIds,
    play: {},
    tags: []
  };
}

function expressionTargetParameters(actionItem) {
  if (actionItem.channelIds.includes("parameter:Param")) {
    return [{ id: "Param", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param2")) {
    return [{ id: "Param2", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param3")) {
    return [{ id: "Param3", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param4")) {
    return [{ id: "Param4", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param6")) {
    return [{ id: "Param6", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param7")) {
    return [{ id: "Param7", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param16")) {
    return [{ id: "Param16", value: 1 }];
  }

  if (actionItem.channelIds.includes("parameter:Param32")) {
    return [{ id: "Param32", value: 1 }];
  }

  return [];
}

function stageIds(actions) {
  return stageIdsFromStages(buildActionFlowStages(actions, durations));
}

function stageIdsFromStages(stages) {
  return stages.map((stage) => stage.actions.map((item) => item.id).join("+"));
}

function assertEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    failures.push(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertFlowInvariants(sequence, stages) {
  const flattened = stages.flatMap((stage) => stage.actions);
  assertEqual(flattened.map((item) => item.id), sequence.map((item) => item.id), `preserves order: ${sequence.map((item) => item.id).join(" -> ")}`);

  for (const stage of stages) {
    if (stage.actions.length === 0) {
      failures.push("stage must not be empty");
    }

    const nonNextChannels = new Set();
    for (const item of stage.actions) {
      if (isNextScoped(item)) {
        continue;
      }

      for (const channel of getFlowChannelIds(item)) {
        if (nonNextChannels.has(channel)) {
          failures.push(`stage channel conflict in ${stage.actions.map((actionItem) => actionItem.id).join("+")}: ${channel}`);
        }
        nonNextChannels.add(channel);
      }
    }
  }

  for (let index = 0; index < sequence.length; index += 1) {
    const item = sequence[index];
    if (!isNextScoped(item)) {
      continue;
    }

    const targetIndex = sequence.findIndex((candidate, candidateIndex) => candidateIndex > index && !isNextScoped(candidate));
    const itemStageIndex = findStageIndexBySequenceIndex(stages, index);
    if (targetIndex === -1) {
      const itemStage = stages[itemStageIndex];
      if (itemStage.actions.length !== 1) {
        failures.push(`tail next action should stand alone: ${sequence.map((seqItem) => seqItem.id).join(" -> ")}`);
      }
      continue;
    }

    const target = sequence[targetIndex];
    const targetStageIndex = findStageIndexBySequenceIndex(stages, targetIndex);
    if (itemStageIndex !== targetStageIndex) {
      failures.push(`next action ${item.id} did not attach to ${target.id}: ${sequence.map((seqItem) => seqItem.id).join(" -> ")}`);
    }
  }
}

function findStageIndexBySequenceIndex(stages, sequenceIndex) {
  let cursor = 0;
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stageLength = stages[stageIndex].actions.length;
    if (sequenceIndex >= cursor && sequenceIndex < cursor + stageLength) {
      return stageIndex;
    }
    cursor += stageLength;
  }

  return -1;
}

function oracleBuildStages(sequence) {
  const stages = [];
  let currentActions = [];
  let currentChannels = new Set();
  let pendingNext = [];

  const push = (items) => {
    if (!items.length) {
      return;
    }

    stages.push({
      actions: items,
      durationMs: Math.max(...items.map((item) => durations[item.id] ?? (item.source === "motion" ? 1600 : 1100)))
    });
  };

  const start = (items) => {
    currentActions = [...items];
    currentChannels = new Set(items.flatMap((item) => getFlowChannelIds(item)));
  };

  for (const item of sequence) {
    if (isNextScoped(item)) {
      pendingNext.push(item);
      continue;
    }

    const itemChannels = getFlowChannelIds(item);
    if (!currentActions.length) {
      start([...pendingNext, item]);
      pendingNext = [];
      continue;
    }

    if (itemChannels.some((channel) => currentChannels.has(channel))) {
      push(currentActions);
      start([...pendingNext, item]);
      pendingNext = [];
      continue;
    }

    currentActions = [...currentActions, ...pendingNext, item];
    pendingNext = [];
    for (const channel of itemChannels) {
      currentChannels.add(channel);
    }
  }

  push(currentActions);
  for (const item of pendingNext) {
    push([item]);
  }

  return stages;
}

function isNextScoped(item) {
  if (item.scope === "next") {
    return true;
  }

  const channels = getFlowChannelIds(item);
  return channels.length > 0 && channels.every((channel) => channel === "region:question-effect" || channel === "region:sparkle-effect");
}

function getFlowChannelIds(item) {
  return [...new Set(item.channelIds.map((channel) => {
    if (channel.startsWith("parameter:")) {
      return mapParameterToChannel(channel.slice("parameter:".length));
    }

    return channel;
  }))];
}

function* enumerateSequences(items, maxLength) {
  yield [];

  function* visit(prefix, depth) {
    if (depth === 0) {
      return;
    }

    for (const item of items) {
      const next = [...prefix, item];
      yield next;
      yield* visit(next, depth - 1);
    }
  }

  yield* visit([], maxLength);
}

async function loadGeneratedActions() {
  const actionsDir = path.join(workspaceRoot, "pets", "official", "cyrene-live2d", "live2d", "generated", "actions");
  const names = await readdir(actionsDir);
  const actions = [];

  for (const name of names) {
    if (!name.endsWith(".json") || name === "index.json") {
      continue;
    }

    const value = JSON.parse(await readFile(path.join(actionsDir, name), "utf8"));
    if (Array.isArray(value.channelIds)) {
      actions.push(value);
    }
  }

  return actions.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadRealActionParameters(actions) {
  const packDir = path.join(workspaceRoot, "pets", "official", "cyrene-live2d");
  const modelDir = path.join(packDir, "live2d");
  const modelSettings = JSON.parse(await readFile(path.join(modelDir, "cyrene.model3.json"), "utf8"));
  const expressionFiles = new Map((modelSettings.FileReferences?.Expressions ?? []).map((expression) => [
    expression.Name,
    expression.File
  ]));
  const expressionParameters = new Map();

  for (const [expressionName, expressionFile] of expressionFiles) {
    const expression = JSON.parse(await readFile(path.join(modelDir, expressionFile), "utf8"));
    expressionParameters.set(expressionName, (expression.Parameters ?? []).map((parameter) => ({
      id: String(parameter.Id),
      value: Number(parameter.Value)
    })));
  }

  return Object.fromEntries(actions.map((actionItem) => [
    actionItem.id,
    actionItem.play?.expression ? (expressionParameters.get(actionItem.play.expression) ?? []) : []
  ]));
}

function collectRealResetParameters(actionParameters) {
  const ids = new Set();
  for (const parameters of Object.values(actionParameters)) {
    for (const parameter of parameters) {
      ids.add(parameter.id);
    }
  }

  return [...ids].map((id) => ({ id, value: 0 }));
}
