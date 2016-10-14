const vscode = require('vscode')
const path = require('path')
const fs = require('fs')
const mkdirp = require('mkdirp')
const _ = require('lodash')
const readline = require('readline')

const CONFIG_DIR = '.vscode/jumpto'
const CONFIG_FILE = '.projections.json'
const TEMPLATE_DIR = path.join(vscode.workspace.rootPath, CONFIG_DIR, 'templates')

function activate(_context) {
    console.log('Extension "JumpTo" is now active!');

    let disposable = vscode.commands.registerCommand('extension.jumpToAlternate', function () {
        try {
            const settings = readSettings()
            const mainFile = vscode.window.activeTextEditor.document.fileName
            findOrCreateAlternate(settings, mainFile)
        } catch (e) { console.log (e) }
    });

    _context.subscriptions.push(disposable);
}

function findOrCreateAlternate(settings, mainFile) {
    const rootPath = vscode.workspace.rootPath
    const mainFileRel = path.relative(rootPath, mainFile)

    const matches = _.filter(settings, (value, key) => {
        const match = matchRule(mainFileRel, key)
        if(match) {
            value.glob = match[1]
        }
        return !!match
    })

    _.forEach(matches, (match) => {
        if(match.alternate) {
            let alternateFileRel = match.alternate.replace('{}', path.parse(match.glob).name)

            if(alternateFileRel === mainFileRel) return

            const alternateFile = path.join(rootPath, alternateFileRel)
            const fileExists = fs.existsSync(alternateFile)

            const context = {
                rootPath,
                mainFile,
                alternateFile
            }

            if (!fileExists) {
                mkdirp.sync(path.dirname(alternateFile))
                const template = resolveTemplate(settings, alternateFileRel, match.glob, context)

                if(template) {
                    fs.appendFileSync(alternateFile, template)
                }
                vscode.window.showInformationMessage(`Alternate file created: ${alternateFileRel}`);
            }

            vscode.workspace.openTextDocument(alternateFile).then((doc) => {
                const viewColumn = vscode.window.activeTextEditor.viewColumn ==
                    vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One
                vscode.window.showTextDocument(doc, viewColumn)
            })
        }
    })
}

function resolveTemplate(settings, alternateFileRel, glob, context) {
    var match = _.find(settings, (value, key) =>
        matchRule(alternateFileRel, key) && (value.template || value.templateFile))

    if(!match) return "/** TODO: No matching template  **/"

    if(match.templateFile) {
        const templateFile = path.join(TEMPLATE_DIR, match.templateFile)
        // TODO - maybe implement this with streams
        // const rs = fs.createReadStream(templateFile)
        // const ts = //TODO
        // const ws = fs.createStream
        // rs.pipe(ts).pipe(ws)
        const template = fs.readFileSync(templateFile).toString()
        match.template = template.split(/\r?\n/)
    }

    if(match.template) {
        if(Array.isArray(match.template)) {
            return _.map(match.template, (line) => transformLine(line, glob, context)).join('\n')
        } else if(typeof match.template === 'string') {
            return match.template
        }
    }
}

function transformLine(line, glob, context) {
    const rx = /{([\s\S]+?)}/g
    line = line.replace('{}', glob)
    let result

    const replaces = []
    while ((result = rx.exec(line)) !== null) {
        const val = _.reduce(result[1].split('|'), (memo, transform) => {
            return doTransform(transform, memo, context)
        }, glob)

        replaces.push({searchFor: result[0], replaceWith: val})
    }

    return _.reduce(replaces, (memo, r) => memo.replace(r.searchFor, r.replaceWith), line)
}

function doTransform(transform, str, context) {
    const transforms = {
        dot: () => str.replace('/', '.'),
        underscore: () => str.replace('/', '_'),
        backlash: () => str.replace('/', '\\'),
        colons: () => str.replace('/', '::'),
        hyphenate: () => str.replace('_', '-'),
        blank: () => str.replace('_', ' ').replace('-', ' '),
        uppercase: () => _.toUpper(str),
        lowercase: () => _.toLower(str),
        snakecase: () => _.snakecase(str),
        camelcase: () => _.camelCase(str),
        capitalize: () => _.capitalize(str),
        dirname: () => path.parse(context.mainFile).dir,
        basename: () => path.parse(context.mainFile).name,
        relative: () => path.dirname(path.relative(context.alternateFile, context.mainFile)),
        singular: () => str,
        plural: () => str,
        file: () => context.alternateFile,
        project: () => context.rootPath,
        open: () => '{',
        close: () => '}'
    }

    return (transforms[transform] || (() => str))()
}


function readSettings() {
    const defaultSettings = {
        // "*": { alternate: "test/{}" }
    }

    const settingsFile = path.join(vscode.workspace.rootPath, CONFIG_FILE)
    let customSettings = {}

    try {
        customSettings = JSON.parse(fs.readFileSync(settingsFile).toString())
    } catch (error) {
        console.log(`No settings file: ${settingsFile}, using defaults`)
    }

    return _.merge({}, defaultSettings, customSettings)
}

function matchRule(str, rule) {
    const re = new RegExp(`^${rule.split("*").join("(.*)")}$`)
    return re.exec(str);
}

function deactivate() {}

exports.activate = activate;
exports.deactivate = deactivate;