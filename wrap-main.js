#!/usr/bin/env node

console.log('IN THE WRAPAMABOB', process.argv)
if (module !== require.main) {
  console.error('are you quite sure this is what you want?')
  process.exit(1)
}

var assert = require('assert')
var n = +(process.argv[2].match(/^--args=([0-9]+)$/)[1])
assert(!isNaN(n) && n >= 0)
var injectArgs = []
var i
for (i = 3; i < n + 3; i++) {
  injectArgs.push(process.argv[i])
}

var n = +(process.argv[i].match(/^--envs=([0-9]+)$/)[1])
assert(!isNaN(n) && n >= 0)
var start = i + 1
for (i = start; i < start + n; i++) {
  var kv = process.argv[i].split('=')
  var key = kv.shift()
  var val = kv.join('=')
  process.env[key] = val
}

assert.equal(process.argv[i], '--')
var n = i - 1
var spliceArgs = [1, i].concat(injectArgs)
process.argv.splice.apply(process.argv, spliceArgs)

console.error(process.argv)

delete require('module')._cache[__filename]
console.log('About to run main file: %j', process.argv[1])
require('module').runMain()
