'use strict';

module.exports = wrap
wrap.runMain = runMain

const Module = require('module')
const fs = require('fs')
const cp = require('child_process')
const ChildProcess = cp.ChildProcess
const assert = require('assert')
const crypto = require('crypto')
const IS_WINDOWS = require('is-windows')()
const makeDir = require('make-dir')
const rimraf = require('rimraf')
const path = require('path')
const signalExit = require('signal-exit')
const {IS_DEBUG, debug} = require("./lib/debug")
const munge = require("./lib/munge")
const homedir = require("./lib/homedir")

const shebang = process.platform === 'os390' ?
  '#!/bin/env ' : '#!'

const shim = shebang + process.execPath + '\n' +
  fs.readFileSync(path.join(__dirname, 'shim.js'))

function wrap(argv, env, workingDir) {
  const spawnSyncBinding = process.binding('spawn_sync')

  // if we're passed in the working dir, then it means that setup
  // was already done, so no need.
  const doSetup = !workingDir
  if (doSetup) {
    workingDir = setup(argv, env)
  }
  const spawn = ChildProcess.prototype.spawn
  const spawnSync = spawnSyncBinding.spawn

  function unwrap() {
    if (doSetup && !IS_DEBUG) {
      rimraf.sync(workingDir)
    }
    ChildProcess.prototype.spawn = spawn
    spawnSyncBinding.spawn = spawnSync
  }

  spawnSyncBinding.spawn = wrappedSpawnFunction(spawnSync, workingDir)
  ChildProcess.prototype.spawn = wrappedSpawnFunction(spawn, workingDir)

  return unwrap
}

function wrappedSpawnFunction (fn, workingDir) {
  return wrappedSpawn

  function wrappedSpawn (options) {
    const mungedOptions = munge(workingDir, options)
    debug('WRAPPED', mungedOptions)
    return fn.call(this, mungedOptions)
  }
}

function setup(argv, env) {
  if (argv && typeof argv === 'object' && !env && !Array.isArray(argv)) {
    env = argv
    argv = []
  }

  if (!argv && !env) {
    throw new Error('at least one of "argv" and "env" required')
  }

  if (argv) {
    assert(Array.isArray(argv), 'argv must be an array')
  } else {
    argv = []
  }

  if (env) {
    assert(typeof env === 'object', 'env must be an object')
  } else {
    env = {}
  }

  debug('setup argv=%j env=%j', argv, env)

  // For stuff like --use_strict or --harmony, we need to inject
  // the argument *before* the wrap-main.
  const execArgv = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      execArgv.push(argv[i])
      if (argv[i] === '-r' || argv[i] === '--require') {
        execArgv.push(argv[++i])
      }
    } else {
      break
    }
  }
  if (execArgv.length) {
    if (execArgv.length === argv.length) {
      argv.length = 0
    } else {
      argv = argv.slice(execArgv.length)
    }
  }

  const key = process.pid + '-' + crypto.randomBytes(6).toString('hex')
  let workingDir = homedir + key

  const settings = JSON.stringify({
    module: __filename,
    deps: {
      foregroundChild: require.resolve('foreground-child'),
      signalExit: require.resolve('signal-exit'),
      debug: require.resolve('./lib/debug')
    },
    isWindows: IS_WINDOWS,
    key,
    workingDir,
    argv,
    execArgv,
    env,
    root: process.pid
  }, null, 2) + '\n'

  if (!IS_DEBUG) {
    signalExit(() => rimraf.sync(workingDir))
  }

  makeDir.sync(workingDir)
  workingDir = fs.realpathSync(workingDir)
  if (IS_WINDOWS) {
    const cmdShim =
      '@echo off\r\n' +
      'SETLOCAL\r\n' +
      'SET PATHEXT=%PATHEXT:;.JS;=;%\r\n' +
      '"' + process.execPath + '" "%~dp0\\.\\node" %*\r\n'

    fs.writeFileSync(path.join(workingDir, 'node.cmd'), cmdShim)
    fs.chmodSync(path.join(workingDir, 'node.cmd'), '0755')
  }
  fs.writeFileSync(path.join(workingDir, 'node'), shim)
  fs.chmodSync(path.join(workingDir, 'node'), '0755')
  const cmdname = path.basename(process.execPath).replace(/\.exe$/i, '')
  if (cmdname !== 'node') {
    fs.writeFileSync(path.join(workingDir, cmdname), shim)
    fs.chmodSync(path.join(workingDir, cmdname), '0755')
  }
  else if (cmdname === 'node') {
    const nodePath = path.dirname(process.execPath)
    const cmds = JSON.parse(env.NYC_CONFIG)._
    cmds.forEach((cmd) => {
      const filepath = path.resolve(nodePath, cmd)
      if (fs.existsSync(filepath + '.cmd')) {
        const batch = fs.readFileSync(filepath + '.cmd', 'utf8')
        const shell = fs.readFileSync(filepath, 'utf8')
        const powershell = fs.readFileSync(filepath + '.ps1', 'utf8')
        fs.writeFileSync(workingDir + '/' + cmd + '.cmd', batch.replace('"%_prog%"  "%dp0%', '"%_prog%"  "' + nodePath))
        fs.chmodSync(workingDir + '/' + cmd + '.cmd', '0755')
        fs.writeFileSync(workingDir + '/' + cmd, shell.replace('"$basedir/node"  "$basedir', '"$basedir/node"  "' + nodePath))
        fs.chmodSync(workingDir + '/' + cmd, '0755')
        fs.writeFileSync(workingDir + '/' + cmd + '.ps1', powershell.replace('node$exe"  "$basedir', 'node$exe"  "' + nodePath))
        fs.chmodSync(workingDir + '/' + cmd + '.ps1', '0755')
      }
    })
  }
  fs.writeFileSync(path.join(workingDir, 'settings.json'), settings)

  return workingDir
}

function runMain () {
  process.argv.splice(1, 1)
  process.argv[1] = path.resolve(process.argv[1])
  delete require.cache[process.argv[1]]
  Module.runMain()
}
