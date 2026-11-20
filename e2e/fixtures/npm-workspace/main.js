const greet = require('greet')
console.log(greet())
console.log(`root: ms@${require('ms/package.json').version}, semver@${require('semver/package.json').version}`)
