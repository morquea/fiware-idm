var models = require('../../models/models.js');
var userController = require('../../controllers/web/users');
var oauthServer = require('oauth2-server');
var Request = oauthServer.Request;
var Response = oauthServer.Response;

var debug = require('debug')('idm:oauth_controller');

// Create Oauth Server model
oauth = new oauthServer({
    model: require('../../models/model_oauth_server.js'),
    debug: true
});

// POST /oauth2/token -- Function to handle token requests
exports.token = function(req,res, next){

    debug(' --> token')
  
	var request = new Request(req);
	var response = new Response(res);

	oauth.token(request,response).then(function(token) {
        res.json(response.body)
    }).catch(function(err){
        res.status(500).json(err)
    })
}

// MW to see if query contains response_type attribute
exports.response_type_required = function(req, res, next) {

    debug(' --> response_type_required')

    if (req.query.response_type && (req.query.response_type === 'code' || req.query.response_type === 'token')) {
        next();
    } else {
        var text = 'Invalid response_type'
        req.session.message = {text: text, type: 'warning'};
        res.redirect('/auth/login');
    }
}

// MW to search application
exports.load_application = function(req, res, next) {

    debug(' --> load_application')

    models.oauth_client.findOne({
        where: {id: req.query.client_id},
        attributes: ['id', 'name', 'description', 'image', 'response_type', 'redirect_uri']
    }).then(function(application) {
        if (application) {
            req.application = application
            next()
        } else {
            var text = 'Application with id = ' + req.query.client_id + ' doesn`t exist'
            req.session.message = {text: text, type: 'warning'};
            res.redirect('/');
        }
    }).catch(function(error) {
        next(error)
    })
}

// MW to check user session
exports.check_user = function(req, res, next) {

    debug(' --> check_user')

    if (req.session.user) {
        check_user_authorized_application(req, res)
    } else {
        res.render('oauth/index', {application: {
            name: req.application.name,
            description: req.application.description,
            response_type: req.query.response_type,
            id: req.query.client_id,
            state: req.query.state,
            redirect_uri: req.query.redirect_uri,
            image: ((req.application.image == 'default') ? '/img/logos/original/app.png' : ('/img/applications/'+req.application.image)) 
        }, errors: [] }); 
    }
}

// POST /oauth2/authorize -- Function to handle authorization code and implicit requests
exports.authenticate_user = function(req, res, next){

    debug(' --> authenticate_user')

    if (req.session.user) {
        check_user_authorized_application(req, res)
    } else {
        // See if inputs are empty
        errors = []
        if (!req.body.email) {
            errors.push({message: 'email'});
        }
        if (!req.body.password) {
            errors.push({message: 'password'});
        }

        // If not, authenticate and search if user is authorized in the application
        if (req.body.email && req.body.password) {
            userController.authenticate(req.body.email, req.body.password, function(error, user) {
                if (error) {  // If error, send message to /auth/login
                    req.session.errors = [{message: error.message}];
                    res.redirect("/auth/login");        
                    return;
                }

                // Create req.session.user and save id and username
                // The session is defined by the existence of: req.session.user
                var image = '/img/logos/small/user.png'
                if (user.gravatar) {
                    image = gravatar.url(user.email, {s:25, r:'g', d: 'mm'}, {protocol: 'https'});
                } else if (user.image !== 'default') {
                    image = '/img/users/' + user.image
                }    
                req.session.user = {id:user.id, username:user.username, email: user.email, image: image};

                check_user_authorized_application(req, res)

            });
        } else {
            req.session.errors = errors;
            res.redirect("/auth/login");  
        }
    }
}

// Check if user has authorized the application
function check_user_authorized_application(req, res) {

    debug(' --> check_user_authorized_application')

    search_user_authorized_application(req.session.user.id, req.application.id).then(function(user) {

        if (user) {
            req.user = user
            oauth_authorize(req, res)
        } else {
            if (req.application.redirect_uri !== req.query.redirect_uri) {
                res.locals.message = {text: 'Mismatching redirect uri', type: 'warning'}  
            }

            res.render('oauth/authorize', {application: {
                name: req.application.name,
                response_type: req.query.response_type,
                id: req.query.client_id,
                redirect_uri: req.query.redirect_uri,
                state: req.query.state }
            });
        }
    }).catch(function(error) {
        req.session.errors = error
        res.redirect('/')
    })
}

// Search user that has authorized tha application
function search_user_authorized_application(user_id, app_id) {

    debug(' --> search_user_authorized_application')

    return models.user_authorized_application.findOne({
        where: {user_id: user_id, oauth_client_id: app_id},
        include: [{
            model: models.user,
            attributes: ['id', 'username', 'gravatar', 'image']
        }]
    }).then(function(user_is_authorized) {
        return user_is_authorized.User
    }).catch(function(error) {
       Promise.reject('Internal error')    
    })
}

// MW to load user
exports.load_user = function(req, res, next) {

    debug(' --> load_user')

    if (req.session.user.id) {
        models.user.findOne({
            where: { id: req.session.user.id}
        }).then(function(user) {
            req.user = user
            next()
        }).catch(function(error) {
            next(error)
        })
    } else {
        res.rediect('/')
    }
}

// POST /oauth2/enable_app -- User authorize the application to see their details and 
exports.enable_app = function(req, res, next){

    debug(' --> enable_app')

    models.user_authorized_application.create({ user_id: req.session.user.id, 
                                                oauth_client_id: req.query.client_id})
    .then(function(row) {
        oauth_authorize(req, res)
    }).catch(function(error) {
        next(error)
    })
}

// Generate code or token
function oauth_authorize(req, res) {

    debug(' --> oauth_authorize')

    req.body.user = req.user

    var request = new Request(req);
    var response = new Response(res);

    oauth.authorize(request, response).then(function(success) {
        res.redirect(success)
    }).catch(function(err){
        res.status(err.code || 500).json(err)
    })
}


// GET /oauth2/token -- Function to handle token authentication
exports.authenticate_token = function(req, res, next){

    debug(' --> authenticate_token')

    var options = {
        allowBearerTokensInQueryString: true
    }

    var request = new Request({
        headers: {authorization: req.headers.authorization},
        method: req.method,
        query: req.query,
        body: req.body
    });
    var response = new Response(res);

    oauth.authenticate(request, response, options).then(function (user_info) {
        var response = {app_id: user_info.oauth_client.id}
        if (user_info.user) {
            if (user_info.user._modelOptions.tableName === 'iot') {
                response['displayName'] = user_info.user.id
            } else if (user_info.user._modelOptions.tableName === 'user') {
                response['displayName'] = user_info.user.username
                response['email'] = user_info.user.email
            } 
        }
        res.send(response)      
    }).catch(function (err) {
        debug('Error ' + err)
        // Request is not authorized.
        res.status(err.code || 500).json(err)
    });
}