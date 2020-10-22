const express = require('express');
const fs = require('fs');
const jsdom = require('jsdom');
const Twit = require('twit')
const Sentiment = require('sentiment');
const gmaps = require('googlemaps');
const sentiment = new Sentiment();
const router = express.Router();
/////////////////////////////////////////////
//// Onkar's editing ///////////////
const redis = require('redis');

const app = express();

require('dotenv').config();
const AWS = require('aws-sdk');

// Cloud Services Set-up
// Create unique bucket name
const bucketName = 'onkarpracone-wikipedia-store';

// const bucketPromise = new AWS.S3({apiVersion: '2006-03-01'}).createBucket({Bucket: bucketName}).promise()
// //deleteObject("*")
//         bucketPromise.then(function(data) {
//             console.log("Successfully created " + bucketName);
//         })
//         .catch(function(err) {
//             console.error(err, err.stack);
//         });
// This section will be changed for cloud services
const redisClient = redis.createClient();

redisClient.on('error', (err) => {
    console.log("Error "+ err);
})

//////////////////////////////////////
router.use(express.static(__dirname + "/../public"));

// my credentials carefully
var T = new Twit({
  consumer_key:         'OaLClaRnqw21WeyF6R3dBUjde',
  consumer_secret:      'Evopx2jpBTwqXHmyKmnrmZaRwQjcAlKAihynvSpKDPIBnObz3W',
  //access_token:         '1030134258-aXzyz8cdihuGQf6saa9q4Ty3OKcfPOuhua77ih2',
  //access_token_secret:  'ed84KBbdeVaXx1JhenUrsRlO99w5wTM96F5fAOvnfZI8g',
  timeout_ms:           60*1000,  // optional HTTP request timeout to apply to all requests.
  strictSSL:            true,     // optional - requires SSL certificates to be valid.
  app_only_auth:        true
})

// empty array
var tweets = [];
let TweetScore = {positive: 0, neutral: 0, negative:0};
var trends = [];

const publicConfig = {
  key: "AIzaSyAH1SGYkNL_spEaTqWovLsnEHIWg3Eht10"
}

const gmapAPI = new gmaps(publicConfig);

function getTw(query, lat, lng, callback) {
  let tweetsHtml = "";
//////////////////////////////////////////////////////
 ///////////////////////////////////////////////////
    ///////////// Persistance  ////////////////////////
    const rediskey = `Ass2:tweets${query}-${lat}-${lng}`;
    const s3Key = `Ass2-tweets${query}-${lat}-${lng}`;
    const params = { Bucket: bucketName, Key: s3Key};

    redisClient.get(rediskey, (err, result)=>{
      if(result) {
          // serve from cache
          console.log("Serving Tweets from CACHE");
         // console.log(result)
          tweetsHtml = result.toString();
          callback(tweetsHtml);
      }else{
              //  new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
              //         if (result) {
              //         // Serve from S3
              //             console.log("Serving from S3");
                          
              //             tweetsHtml = result.Body.toString();
              //             callback(tweetsHtml);
                          
              //         }
              //         else{
                        T.get('search/tweets', {geocode: `${lat},${lng},150km`, q: query, exclude: "retweets", count: 20, lang: 'en' }, function(err, data, response) {
                          // saving in array and print for varifying
                          for(let i = 0; i<data.statuses.length; i++){
                            // sentiment analysis on tweet
                            let result = sentiment.analyze(data.statuses[i].text);
                      
                            // print result
                            if(i==0) {
                              console.log(result.calculation);
                            }
                            
                      
                            // save tweet in tweets array
                            tweets[i] = [`${data.statuses[i].user.name}`,` ${data.statuses[i].user.followers_count}`, `${data.statuses[i].text}` ,
                            `${data.statuses[i].retweet_count}`, `${data.statuses[i].id_str}`, `${data.statuses[i].user.screen_name}`, `${result.score}`,
                            `${data.statuses[i].user.profile_image_url_https}`, `${data.statuses[i].user.screen_name}`] 
                      
                            if(tweets[i][6] !== 0 || undefined){
                              if (tweets[i][6] == 0){
                                  TweetScore.neutral= TweetScore.neutral + 1 ;
                              }
                              else if(tweets[i][6] < 0){
                                TweetScore.negative= TweetScore.negative + 1;
                              }
                              else if(tweets[i][6] > 0){
                                TweetScore.positive= TweetScore.positive + 1;
                              }
                            }
                          }
                          
                          //make it ready to send to home page
                          if (tweets[1] !== null || undefined){
                              // printing list in format
                              for(let i = 0; i < tweets.length;i++){
                                tweetsHtml += `<a href="https://twitter.com/${tweets[i][5]}/status/${tweets[i][4]}" target="_blank" class="tweet-link">`+
                                `<li class="list-group-item" id="tweet-item"><div class="media"><img src="${tweets[i][7]}" class="mr-3" alt="..."><div class="media-body">`+
                                `<div id="username"><h5 class="name">${tweets[i][0]} </h5><h5 class="twit-handle">@${tweets[i][8]}</h5></div>`+
                                `<h3 class="followers-retweets">Followers: ${tweets[i][1]} || Retweets: ${tweets[i][3]}</h3>` +
                                `${tweets[i][2]}</img></div></li></a>`  

                                


                              }
                                ///////////// savig to the redis //////////// 
                                ///////   the 120 is tge seconds after the redis will clear the cahce.
                                redisClient.setex(rediskey, 120, tweetsHtml);
                                console.log("saved Tweets in cache")

                                //// saving into S3  //////////////
                                const body = tweetsHtml;
                                const objectParams = {Bucket: bucketName, Key: s3Key, Body: body};
                                const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();
                                uploadPromise.then(function(data) {
                                    console.log("Successfully uploaded Tweets to " + bucketName + "/" + s3Key);
                                    });
                                    callback(tweetsHtml);
                                   
                           }else{
                            new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
                                      if (result) {
                                      // Serve from S3
                                          console.log("Serving tweets from S3");
                                          
                                          tweetsHtml = result.Body.toString();
                                          callback(tweetsHtml);
                                          
                                      }
                                      else{
                                        T.get('search/tweets', {geocode: `${lat},${lng},2500km`, q: query, exclude: "retweets", count: 20, lang: 'en' }, function(err, data, response) {
                                          // saving in array and print for varifying
                                          for(let i = 0; i<data.statuses.length; i++){
                                            // sentiment analysis on tweet
                                            let result = sentiment.analyze(data.statuses[i].text);
                                      
                                            // print result
                                            if(i==0) {
                                              console.log(result.calculation);
                                            }
                                            
                                      
                                            // save tweet in tweets array
                                            tweets[i] = [`${data.statuses[i].user.name}`,` ${data.statuses[i].user.followers_count}`, `${data.statuses[i].text}` ,
                                            `${data.statuses[i].retweet_count}`, `${data.statuses[i].id_str}`, `${data.statuses[i].user.screen_name}`, `${result.score}`,
                                            `${data.statuses[i].user.profile_image_url_https}`, `${data.statuses[i].user.screen_name}`] 
                                      
                                            if(tweets[i][6] !== 0 || undefined){
                                              if (tweets[i][6] == 0){
                                                  TweetScore.neutral= TweetScore.neutral + 1 ;
                                              }
                                              else if(tweets[i][6] < 0){
                                                TweetScore.negative= TweetScore.negative + 1;
                                              }
                                              else if(tweets[i][6] > 0){
                                                TweetScore.positive= TweetScore.positive + 1;
                                              }
                                            }
                                          }
                                          
                                          //make it ready to send to home page
                                          if (tweets[1] !== null || undefined){
                                              // printing list in format
                                              for(let i = 0; i < tweets.length;i++){
                                                tweetsHtml += `<a href="https://twitter.com/${tweets[i][5]}/status/${tweets[i][4]}" target="_blank" class="tweet-link">`+
                                                `<li class="list-group-item" id="tweet-item"><div class="media"><img src="${tweets[i][7]}" class="mr-3" alt="..."><div class="media-body">`+
                                                `<div id="username"><h5 class="name">${tweets[i][0]} </h5><h5 class="twit-handle">@${tweets[i][8]}</h5></div>`+
                                                `<h3 class="followers-retweets">Followers: ${tweets[i][1]} || Retweets: ${tweets[i][3]}</h3>` +
                                                `${tweets[i][2]}</img></div></li></a>`
                                      }}
                                      callback(tweetsHtml);
                                    })
                           }
                          })
                      }
                     // })


////////////////////////////////////////////////////////////////

  
     
    });
      
}})
   }


function getClosest(lat, lng, callback) {
  T.get('trends/closest', {lat: lat,long: lng }, function(err, data, response) {
    callback(data[0].woeid, data[0].name);
  })
}

function getTre(woeid, callback) {
  let trendsHtml = [""];
///////////// Persistance  ////////////////////////
const rediskey = `Ass2:trends${woeid}`;
const s3Key = `Ass2-trends-${woeid}`;
const params = { Bucket: bucketName, Key: s3Key};

redisClient.get(rediskey, (err, result)=>{
  if(result) {
      // serve from cache
      console.log("Serving from CACHE");
     // console.log(result)
      let newresult = result.toString();
      let myarray = newresult.split("<br>");
      trendsHtml[0] = myarray[0]
      trendsHtml[1] = myarray[1]
      callback(trendsHtml);
  }else{
    new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
      if (result) {
      // Serve from S3
          console.log("Serving Trends from S3");
          let newresult = result.Body.toString();
      let myarray = newresult.split("<br>");
      trendsHtml[0] = myarray[0]
      trendsHtml[1] = myarray[1]
      let saveHtml = trendsHtml[0]+"<br>"+trendsHtml[1]
      redisClient.setex(rediskey, 120, saveHtml);
                                
      console.log("saved trends in cache")
      callback(trendsHtml);
      }
      else{

  T.get('trends/place', {id: woeid, lang: 'en'}, function(err, data, response) {
    // saving in array and print for varifying
    for(let i = 0; i< data[0].trends.length; i++){
      trends[i] = data[0].trends[i].name
    }

    trendsHtml[1] = "<h7>Trending Topics at <b>" + data[0].locations[0].name + "</b></h7>"

    //make it ready to send to home page
    if (trends != undefined){
      // printing list in format
      for(let i = 0; i < data[0].trends.length;i++){
        trendsHtml[0] += `<li class="list-group-item id="topic"><h6 id="trending-topics">${trends[i]}</h6></li>`  
      }

      let saveHtml = trendsHtml[0]+"<br>"+trendsHtml[1]
      redisClient.setex(rediskey, 120, saveHtml);
                                
      console.log("saved trends in cache")

                                //// saving into S3  //////////////
      const body = saveHtml;
      const objectParams = {Bucket: bucketName, Key: s3Key, Body: body};
      const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();
      uploadPromise.then(function(data) {
      console.log("Successfully uploaded trends data to " + bucketName + "/" + s3Key);
       });
                                    

      callback(trendsHtml);
    }
  })
}

    })}



})
}

function getRateLimit() {
  T.get('application/rate_limit_status', {resources: ["search", "trends"]}, function(err, data, response) {
    console.log(data.resources.trends);
    console.log(data.resources.search);

  })
}

/* GET users listing. */
router.get('/asdas', function(req, res, next) {
  const html = fs.readFileSync(__dirname + '/tweets.html','utf8');
  const dom  = new jsdom.JSDOM(html);
  const query = req.query.q;
  const lat = req.query.lat;
  const lng = req.query.lng;

  getRateLimit()

  // get tweets using callback and send modified html

    getClosest(lat, lng, function(woeid, name) {
      gmapAPI.geocode({address: name}, function(err, data) {
        const { lng, lat } = data.results[0].geometry.location;
        console.log("lng:" + lng + " lat: " + lat);
        getTweets(query, lat, lng, function(tweetsHtml) {
          dom.window.document.getElementById("tweets").innerHTML = tweetsHtml;

          getTrends(woeid, function(trendsHtml) {
            dom.window.document.getElementById("trending-at").innerHTML = trendsHtml[1];
            dom.window.document.getElementById("trending-topics").innerHTML = trendsHtml[0];
            res.send(dom.window.document.querySelector("html").innerHTML);
          })
      })
    })
  })
});

module.exports = router;
