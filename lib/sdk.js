var AdmZip = require('adm-zip'),
	async = require('async'),
	constants = require('./constants'),
	exec = require('child_process').exec,
	fs = require('fs'),
	path = require('path'),
	request = require('request'),
	tiappXml = require('tiapp.xml'),
	U = require('./utils');

module.exports = function sdk(opts, callback) {

	// validate input
	callback = U.maybeCallback(arguments[arguments.length-1]);
	if (!opts || U.isFunction(opts)) {
		opts = {};
	}

	// validate command type
	var type = opts.type || 'get';
	if (type !== 'get' && type !== 'set' && type !== 'install' && type !== 'update') {
		return callback(new Error('Invalid type "' + type + '"'));
	}

	try {
		var tiapp;

		if (type === 'get') {

			tiapp = tiappXml.load(opts.tiapp);

			// get the tiapp property holding the SDK name
			var mwSdk = tiapp.getProperty('mw-sdk-name');
			if (!mwSdk) {
				return callback(null, null);
			}

			// search for the installed module
			var modules = tiapp.getModules();
			for (var i = 0; i < modules.length; i++) {
				if (modules[i].id === mwSdk) {

					// return module object if found
					return callback(null, modules[i]);
				}
			}
		} else if (type === 'set') {

			if (!opts.name) {
				return callback(new Error('No sdk name specified for sdk() with type "set"'));
			}

			tiapp = tiappXml.load(opts.tiapp);

			// write sdk name as tiapp property
			tiapp.setProperty('mw-sdk-name', opts.name, 'string');

			// set the native commonjs module
			tiapp.setModule(opts.name, {
				version: opts.version,
				platform: 'commonjs'
			});

			// write the tiapp.xml
			tiapp.write();

		} else if (type === 'install' || type === 'update') {

			// pass in opts, prompt for creds, authenticate, then get updates
			return async.waterfall([
				function(cb) { return cb(null, opts); },
				U.authenticate, updateRequest
			], callback);

		}
	} catch (e) {
		var error = new Error(type + ' command failed: ' + e.message);
		error.exception = e;
		return callback(error);
	}

	return callback(null, null);
};

function updateRequest(opts, callback) {
	return U.doRequest(
		constants.UPDATE_API,
		{
			method: 'GET',
			cookie: opts.cookie,
			host: opts.host,
			port: opts.port,
			success: function(res, data) {
				try {
					var ti = path.join(__dirname,'..','node_modules','.bin','titanium'),
						cmd = ti + ' sdk -o json';

					exec(cmd, function(err, stdout) {
						if (err) { throw err; }
						var tiPath = JSON.parse(stdout).defaultInstallLocation,
							updates = JSON.parse(data).result.modules;

						updates = updates.filter(function(i) {
							return (!opts.name || i.name === opts.name) &&
								(!opts.version || i.version === opts.version) ;
						});

						var updateResult = [];
						async.each(updates, function(i, cb) {
							var moduleName = path.basename(i.url),
								modulePath = path.join(tiPath, moduleName);

							// skip update if we already have it
							var moduleDir = path.join(tiPath, 'modules', 'commonjs', i.name, i.version);
							if (fs.existsSync(moduleDir) && !opts.force) {
								return cb();
							}

							var req = request(i.url);
							req.pipe(fs.createWriteStream(modulePath));
							req.on('end', function() {
								var zip = new AdmZip(modulePath);
								zip.extractAllTo(tiPath, true);
								updateResult.push({
									name: i.name,
									version: i.version,
									dir: moduleDir
								});
								fs.unlinkSync(modulePath);
								return cb();
							});
						}, function(err) {
							if (err) {
								return callback(new Error(err));
							}
							return callback(null, updateResult);
						});
					});
				} catch (e) {
					var error = new Error('update request failed: ' + e.message);
					error.exception = e;
					return callback(error);
				}
			}
		},
		callback
	);
}
