const rec = require('node-record-lpcm16')
const record = require('node-record-lpcm16')
const request = require('request')
const snowboy = require('snowboy')
const thunkify = require('thunkify-wrap')
const co = require('co')
const q = require('q')
const api = require('./api')
const response_handler = require('./response')
const speak = require('./speak')

const stdin = process.openStdin()
const Detector = snowboy.Detector
const Models = snowboy.Models
const models = new Models()
const witToken = 'UBBQSYVZACKPUKF5J7B3ZHGYDP7H45E3'
const sleep = require('sleep');
let is_recognizing = false

models.add({
    file: './resources/Brain.pmdl',
    sensitivity: '0.5',
    hotwords: 'brain'
})

function * parseResult(body) {
    try {
        body = JSON.parse(body[0].body)
        const query = body._text
        if (query && query !== '' && !is_recognizing) {
            is_recognizing = true
            const response = yield api.get(query)
            yield response_handler.handle(response)
            is_recognizing = false
        }
    } catch (err) {
        console.log(err)
        speak.vocalize('Ooops, I didn\'t get that', 'Alex', 1.1)
    }
}

function generatorify(fn, context) {
    return function () {
        const deferred = q.defer()

        const callback = make_callback(deferred)
        const args = Array.prototype.slice.call(arguments).concat(callback)

        fn.apply(context, args)

        return deferred.promise
    }
}

function make_callback(deferred) {
    return function (err) {
        if (err) {
            deferred.reject(err)
        } else if (arguments.length < 2) {
            deferred.resolve()
        } else if (arguments.length === 2) {
            deferred.resolve(arguments[1])
        } else {
            deferred.resolve(Array.prototype.slice.call(arguments, 1))
        }
    }
}

function recognizer(callback) {
    rec.start({
	recordProgram: 'arecord'
    }).pipe(request.post({
        url: 'https://api.wit.ai/speech?client=chromium&lang=en-us&v=20160526',
        headers: {
            Accept: 'application/vnd.wit.20160526+json',
            Authorization: 'Bearer ' + witToken,
            'Content-Type': 'audio/wav',
            'Transfer-encoding': 'chunked'
        }
    }, callback))
    // Stop recording after three seconds 
    setTimeout(function () {
	rec.stop()
    }, 3000)
}

function * start_recognition() {
    const gen_recognizer = generatorify(recognizer)
    const recognized = yield gen_recognizer()

    yield parseResult(recognized)

    rec.stop()
}

function * start_hotword_detection() {
    var hotword_detected = false;
    
    while (1) {
	hotword_detected = false;

	var detector = new Detector({
	    resource: './resources/common.res',
	    models,
	    audioGain: 2.0
	})

	detector.on('hotword', function () {
	    hotword_detected = true;
	    record.stop()
	})

	const end = thunkify.event(detector, 'finish');

	try {
	    record.start({
		threshold: 0,
		verbose: false
	    }).pipe(detector)

	    // wait for record to end before starting next record process
            yield end()

	    // check to make sure we detected the hotword
	    if ( hotword_detected ) {
		yield speak.vocalize_affirm()
		yield start_recognition()
	    } else {
		// something went wrong, sleep then try again
		sleep.sleep(5)
	    }
	} catch (err) {
            console.log(err)
            throw err
	}
    }
}

function console_input(query) {
    return co(function * () {
        query = query.toString().trim()
        const response = yield api.get(query)
        yield response_handler.handle(response)
    }).catch(err => {
        console.log(err)
        throw err
    })
}

stdin.addListener('data', console_input)
// hotword_recorder.pipe(detector)

co(function * () {
    console.log('P-Brain Says: Say \'Hey Brain\',\'Brain\' or \'Okay Brain\' followed by your command!')
    console.log('P-Brain Says: You can also type your command into the terminal!')
    yield start_hotword_detection()
}).catch(err => {
    console.log(err)
    throw err
})
