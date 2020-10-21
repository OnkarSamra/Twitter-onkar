const express = require('express');
const fs = require('fs');
const jsdom = require('jsdom');
const Twit = require('twit')
const Sentiment = require('sentiment');
const gmaps = require('googlemaps');
const sentiment = new Sentiment();
const Chart = require("chart.js");
const redis = require('redis');
const AWS = require('aws-sdk');
const router = express.Router();

router.use(express.static(__dirname + "/../public"));
const redisFlush = 300;

// bucket
const bucketName = 'tweet-explorer-onkarly';

// redis 
const redisClient = redis.createClient();

redisClient.on('error', (err) => {
    console.log("Error "+ err);
})

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
var trends = [];

const publicConfig = {
  key: "AIzaSyAH1SGYkNL_spEaTqWovLsnEHIWg3Eht10"
}

const gmapAPI = new gmaps(publicConfig);

function getTweets(query, lat, lng, callback) {
  let tweetsHtml = "";
  let querySentiment = [0,0,0];


  const rediskey = `tweets:${query}-${lat}-${lng}`;
  const rediskey2 = `analysis:${query}-${lat}-${lng}`;
  const s3Key = `tweets-${query}-${lat}-${lng}`;
  const s3Key2 = `analysis-${query}-${lat}-${lng}`;
  const params = { Bucket: bucketName, Key: s3Key};
  const params2 = { Bucket: bucketName, Key: s3Key2};

  redisClient.get(rediskey, (err, result)=>{
    if(result) {
        // serve from cache
        console.log("Serving Tweets from Redis");
       // console.log(result)
        tweetsHtml = result.toString();
        redisClient.get(rediskey2, (err, result)=>{
          if (err) {
            return err;
          } else {
            let sentiments = result.split(",");
            querySentiment[0] = parseInt(sentiments[0], 10);
            querySentiment[1] = parseInt(sentiments[1], 10);
            querySentiment[2] = parseInt(sentiments[2], 10);
          }
          callback(tweetsHtml, querySentiment);
        })
    } else {
  // getting tweets
  //  checking into the se bucket
  new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
    if (result) {
    // Serve from S3
        console.log("Serving Tweets from S3");
        
        tweetsHtml = result.Body.toString();
        new AWS.S3({apiVersion: '2006-03-01'}).getObject(params2, (err, result2) => {
          if(err){
            throw err;
          }else{
            let sentiments = result2.Body.toString().split(",");
            querySentiment[0] = parseInt(sentiments[0], 10);
            querySentiment[1] = parseInt(sentiments[1], 10);
            querySentiment[2] = parseInt(sentiments[2], 10);
          // Save to Redis, flush every 5 mins
          redisClient.setex(rediskey, redisFlush, tweetsHtml);
          redisClient.setex(rediskey2, redisFlush, querySentiment.toString());
          callback(tweetsHtml,querySentiment);
          }
        })
    } else {
      // getting data from APi
      T.get('search/tweets', {geocode: `${lat},${lng},150km`, q: query, exclude: "retweets", count: 100, lang: 'en' }, function(err, data, response) {
        // saving in array and print for varifying
        for(let i = 0; i<data.statuses.length; i++){
          // sentiment analysis on tweet
          let result = sentiment.analyze(data.statuses[i].text);

          // save tweet in tweets array
          tweets[i] = [`${data.statuses[i].user.name}`,` ${data.statuses[i].user.followers_count}`, `${data.statuses[i].text}` ,
          `${data.statuses[i].retweet_count}`, `${data.statuses[i].id_str}`, `${data.statuses[i].user.screen_name}`, `${result.score}`,
          `${data.statuses[i].user.profile_image_url_https}`, `${data.statuses[i].user.screen_name}`] 

          // sentiment analysis
          if(result.score != undefined){
            if(result.score > 0){
              querySentiment[0]++;
            }
            else if (result.score == 0){
              querySentiment[1]++;
            }
            else if(result.score < 0){
              querySentiment[2]++;
            }
          }
        }
        
        //make it ready to send to home page
        if (tweets != undefined){
            // printing list in format
            for(let i = 0; i < tweets.length;i++){
              tweetsHtml += `<a href="https://twitter.com/${tweets[i][5]}/status/${tweets[i][4]}" target="_blank" class="tweet-link">`+
              `<li class="list-group-item" id="tweet-item"><div class="media"><img src="${tweets[i][7]}" class="mr-3" alt="..."><div class="media-body">`+
              `<div id="username"><h5 class="name">${tweets[i][0]} </h5><h5 class="twit-handle">@${tweets[i][8]}</h5></div>`+
              `<h3 class="followers-retweets">Followers: ${tweets[i][1]} || Retweets: ${tweets[i][3]}</h3>` +
              `${tweets[i][2]}</img></div></li></a>`  
            }
            
            // Save to Redis, flush every 120 secs
            redisClient.setex(rediskey, redisFlush, tweetsHtml);
            redisClient.setex(rediskey2, redisFlush, querySentiment.toString());
            console.log("Saved Tweets in cache")

            // Save into S3
            const body = tweetsHtml;
            const objectParams = {Bucket: bucketName, Key: s3Key, Body: body};
            let uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();
            uploadPromise.then(function(data) {
              console.log("Saved Tweets to " + bucketName + "/" + s3Key);
            });

            const body2 = querySentiment.toString();
            const objectParams2 = {Bucket: bucketName, Key: s3Key2, Body: body2};
            uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams2).promise();
            uploadPromise.then(function(data) {
              console.log("Saved Tweets to " + bucketName + "/" + s3Key2);
            });
            // Sending list to the home page of ""localhost:3000/users""
            callback(tweetsHtml, querySentiment);
        }
      })
     }
     }) // end of T
    }
  })
}

function getClosest(lat, lng, callback) {
  T.get('trends/closest', {lat: lat,long: lng }, function(err, data, response) {
    let woeid = 0;
    let location = "";

    if (err) {
      // if rate limit reached, set location to Brisbane
      woeid = 1100661;
      location = 'Brisbane'
    } else {
      woeid = data[0].woeid;
      location = data[0].name;
    }

    callback(woeid, location);
  })
}

function getTrends(woeid, callback) {
  let trendsHtml = [""];

  const rediskey = `trends:${woeid}`;
  const s3Key = `trends-${woeid}`;
  const params = { Bucket: bucketName, Key: s3Key};
  redisClient.get(rediskey, (err, result)=>{
    if(result) {
      // serve from cache
      console.log("Serving Trends from Redis");
    // console.log(result)
      let newresult = result.toString();
      let myarray = newresult.split("<br>");
      trendsHtml[0] = myarray[0]
      trendsHtml[1] = myarray[1]
      callback(trendsHtml);
    } else {
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
        } else {
          T.get('trends/place', {id: woeid, lang: 'en'}, function(err, data, response) {
            // saving in array and print for varifying
            for(let i = 0; i< data[0].trends.length; i++){
              trends[i] = data[0].trends[i].name
            }

            trendsHtml[1] = "<h9>Trending Topics at " + data[0].locations[0].name + "</h9>"

            //make it ready to send to home page
            if (trends != undefined){
              // printing list in format
              for(let i = 1; i < data[0].trends.length;i++){
                let tweet_vol = data[0].trends[i].tweet_volume;
                if (tweet_vol === null) {
                  tweet_vol = "unknown"
                }
                trendsHtml[0] += `<li class="list-group-item d-flex justify-content-between align-items-center" id="topic">` + 
                `<h6 id="topic-index">${i}</h6><h6 id="trending-topics">${trends[i]}</h6>` + 
                `<span class="badge badge-primary badge-pill"> ${tweet_vol}</span></li>` 
              }
              let saveHtml = trendsHtml[0]+"<br>"+trendsHtml[1]
              redisClient.setex(rediskey, redisFlush, saveHtml);
                                        
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
          }) // end of T
        }
      }) // end of S3
    }
  })
}

function getRateLimit() {
  T.get('application/rate_limit_status', {resources: ["search", "trends"]}, function(err, data, response) {
    console.log("\n/trends/closest: " + data.resources.trends["/trends/closest"].remaining  + "/" + data.resources.trends["/trends/closest"].limit);
    console.log("/trends/place: " + data.resources.trends["/trends/place"].remaining + "/" + data.resources.trends["/trends/place"].limit);
    console.log("/search/tweets: " +data.resources.search["/search/tweets"].remaining + "/" + data.resources.search["/search/tweets"].limit + "\n");
  })
}

/* GET users listing. */
router.get('/', function(req, res, next) {
  const html = fs.readFileSync(__dirname + '/tweets.html','utf8');
  const dom  = new jsdom.JSDOM(html);
  const query = req.query.q;
  const lat = req.query.lat;
  const lng = req.query.lng;

  getRateLimit();
  
  // Get page content via API and send modified HTML
  getClosest(lat, lng, function(woeid, name) {
    gmapAPI.geocode({address: name}, function(err, data) {
      const { lng, lat } = data.results[0].geometry.location;
      getTweets(query, lat, lng, function(tweetsHtml, sentiment) {
        dom.window.document.getElementById("tweets").innerHTML = tweetsHtml;
        
        getTrends(woeid, function(trendsHtml) {
          dom.window.document.getElementById("trending-at").innerHTML = trendsHtml[1];
          dom.window.document.getElementById("trending-topics").innerHTML = trendsHtml[0];
          dom.window.document.getElementById("chart-script").setAttribute("value", `${sentiment[0]}, ${sentiment[1]}, ${sentiment[2]}`)
          res.send(dom.serialize());  
          
        })
      })
    })
  })
});

module.exports = router;
