const ms = require('ms')
const isNumber = require('is-number')
const shared = require('../shared.js') // outside the package: resolves from its real path, not node_modules/greet
module.exports = () => `greet: ms@${require('ms/package.json').version} ${ms(60000)}, is-number@${require('is-number/package.json').version} ${isNumber('42')}, ${shared}`
