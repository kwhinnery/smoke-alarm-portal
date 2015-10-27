var env = process.env.NODE_ENV || 'development';
var config = require(__dirname + '/../../config/config.json')[env];
var twilio = require('twilio');
var parser = require('parse-address'); 

var http = require('http'),
    express = require('express'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser');

var i18n = require('i18n-2');

var app = express();
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(cookieParser());

/* Apparently this function call is unnecessary since we instantiate an
   i18n object below, but how does that accomplish the same task??

// Attach the i18n property to the express request object
// And attach helper methods for use in templates
i18n.expressBind(app, {
    // setup some locales - other locales default to en silently
    locales: ['en', 'de'],
    // change the cookie name from 'lang' to 'locale'
    cookieName: 'locale'
});
*/

app.use(function(req, res, next) {
    req.i18n.setLocaleFromCookie();
    // can set this here for testing purposes
    // req.i18n.setLocale('es');
    next();
});

var i18n_inst = new (i18n)({
    // setup some locales - other locales default to en silently
    locales: ['en', 'es'],
    // change the cookie name from 'lang' to 'locale'
    cookieName: 'locale'
});
var __ = function(s) { return i18n_inst.__(s); }

var serial_num = "example serial";
var rc_local = "(555)-not-real";

// array of script responses
var responses_array = [__('Welcome to the smoke alarm request system \(para español, texto "ES"\).') + " " + __('We need to ask four questions to process your request. Please text back the answer to each and wait for the next question. First, what is your name?'), __('What is your address, including the unit number, city, state, and zipcode?'), __('Sorry, we couldn\'t process your zipcode. Please text us your 5-digit zipcode.'), __('Is the number you\'re texting from the best way to get in touch with you?') + " " + __('If so, text YES. Otherwise, please text a phone number where we can reach you.'), __('One last question: is there an email address we can use to contact you?') + " " + __('If not, text NONE. If yes, please text us the email address.'), __('Thank you for your smoke alarm request! Your request number is %s.', serial_num), __('To contact your local Red Cross about this request, call %s. We will be in touch with you to schedule an installation.', rc_local)];
var request_object = {};

// include the functions from views/index.js
var save_utils = require('../utilities');

/*
 * Takes: the "outcome" (a boolean that is true iff the entered zip code
 * is valid and in an active region),
 * If the outcome was successful:
 * serial: the serial number assigned to the request
 * county: the county found based on the entered zipcode
 * contact: the phone number for this RC region
 *
 * Returns: a message with "thank you," the serial number, and a contact
 * phone for successful outcomes and a "sorry" message with a generic RC
 * phone number for out-of-area zip codes (just like the website).
*/
var constructFinalText = function (outcome, request, contact) {
    var twiml = new twilio.TwimlResponse();
    if (outcome) {
        var msg = "Thank you for your smoke alarm installation request. If you need to contact the Red Cross about this request, use ID number " + request.serial +  " and call your local group at " + contact + ". Your information has been sent to the Red Cross representative for " + request.county +  ". A representative will contact you with information on installation availability in your area. Please allow two to four weeks for a response.";
    }
    else {
        if (request.county) {
            var msg = "Sorry, the Red Cross Region serving " + request.county +  " does not yet offer smoke alarm installation service. However, we will remember your request with ID number " + request.serial + " and contact you when smoke alarm installation service is available in your region. Thank you for contacting the Red Cross.";
        }
        else {
            // invalid zip
            var msg = "Sorry, we couldn't find a county for zip code " + request.zip_final + ".  However, we will remember your request with ID number " + request.serial + ".  Thank you for contacting the Red Cross.";
        }
    }
    twiml.message(msg);
};


/* Generally to find the county and region we use the zipcode, so this
 * takes the entered zip.
 * Returns nothing, but saves the request to the database.
*/
var saveRequest = function (zip) {
    save_utils.findAddressFromZip(zip).then(function(address) {
        request_object.county = address['county'];
        return save_utils.findCountyFromAddress(address, zip);
    }).then( function(county_id){
        if (county_id){
            region_code = county_id.region;
        }
        else {
            region_code = null
        }
        // add pieces of the street address as they exist
        request_object.street_address = "";
        var street_address_arr = [request_object.address.number, request_object.address.street, request_object.address.type, request_object.address.sec_unit_type, request_object.address.sec_unit_num];
        street_address_arr.forEach( function (element) {
            if (element) {
                request_object.street_address = request_object.street_address + " " + element;
            }
        });
        request_object.city = request_object.address.city;
        request_object.state = request_object.address.state;
        request_object.zip_final = request_object.address.zip;
        request_object.assigned_rc_region = region_code;
        return save_utils.countRequestsPerRegion(region_code);
    }).then( function(numRequests) {
        requestData = save_utils.createSerial(numRequests, request_object, region_code);
        requestData.is_sms = 'sms';
        return save_utils.saveRequestData(requestData);
    }).then(function(request) {
        savedRequest = request;
        return save_utils.isActiveRegion(savedRequest);
    }).then( function(activeRegion){
        var is_valid = null;
        var contact_num = null;
        if (activeRegion) {
            save_utils.sendEmail(savedRequest, activeRegion);
            is_valid = true;
            contact_num = activeRegion.contact_phone;
        }
        else{
            is_valid = false;
        }
        constructFinalText(is_valid, request_object, contact_num); 

    }).catch(function(error) {
        // send sorry
        constructFinalText(false, request_object, null);
    });
};
 
exports.respond = function(req, res) {
    var twiml = new twilio.TwimlResponse();
    var counter = parseInt(req.cookies.counter) || 0;

    // Increment or initialize views, up to the length of our array.  If
    // we're at the end of the array, start over.
    if (counter >= responses_array.length) {
        counter = 0;
    }
    counter = 0; // REMEMBER TO TAKE THIS OUT!!
    // Not thrilled about the magic numbers here.  What's a better way
    // to do this?

    // Use the counter to find out what information is arriving:
    if (counter == 1) {
        if (req.query.Body == 'ES'){
            // start sending spanish texts
            // set i18n to spanish
            //i18n.setLocale('es');
            
            // may need to reset the counter here.
            
        }
        else{
            request_object.name = req.query.Body;
        }
    }
    else if (counter == 2) {
        // then it is their address
        request_object.address = req.query.Body;
        request_object.address = parser.parseLocation(request_object.address);
        if (request_object.address.zip) {
            // if they've included their zip, skip the extra "please
            // send your zip" text.
            counter = counter + 1;
        }
    }
    else if (counter == 3) {
        // should only be here if we had to send the zipcode text
        // process it slightly
        req.query.Body;
        var zipset = save_utils.findZipForLookup(req);
        if (request_object.address) {
            request_object.address.zip = zipset.zip_final;
        }
        else {
            request_object.address = "";
            request_object.address.zip =  zipset.zip_final;
        }
    }
    else if (counter == 4) {
        var phone_check = req.query.Body;
        // handle any capitalization
        phone_check = phone_check.toLowerCase();
        if (phone_check == "yes") {
            request_object.phone = req.query.From;
        }
        else {
            request_object.phone = req.query.Body;
        }
    }
    else if (counter == 5) {
        // this is their email address, or none.
        request_object.email = req.query.Body;
        if (request_object.address) {
            var response_elements = saveRequest(request_object.address.zip);
        }
    }

    // construct a request object and insert it into the db

    // may need to change this to account for varying scripts with i18n.
    if (counter < (responses_array.length -1 )){
        twiml.message(responses_array[counter]);
    }
    // else the message will be sent from "construct final text"

    counter = counter + 1;
    res.cookie('counter',counter);
    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());

};

