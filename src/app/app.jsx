import React from 'react'
import ReactDOM from 'react-dom'

'use strict';

// simple event controller to handle pub sub
function EventController() {
  this.listeners = [];

  this.onEvent = function(e) {
    this.listeners.map(function(listener) { listener(e); });
  }

  this.subscribe = function(listener) {
    this.listeners.push(listener);
  }

  this.unsubscribe = function(listener) {
    var index = this.listeners.indexOf(listener);

    if (index > -1)
      this.listeners.splice(index, 1);

    return index != -1;
  }
}


// handles location information
function LocObject(zipCode, city, state) {
    this.zip = zipCode;
    this.city = city;
    this.state = state;
    this.name = city + ", " + state
}

var defaultLoc = new LocObject("02138", "Cambridge", "MA")


// manages local storage for locations
var _LocationDB = function() {
  var that = this;

  // returns all loc objects on event
  this.onLocationChange = new EventController();

  // returns loc object on event
  this.onPrefLocationChange = new EventController();

  // codifies and saves locations to storage
  function _setLocations(obj) {
    localStorage.setItem("locations", JSON.stringify(obj));
    that.onLocationChange.onEvent(obj);
  }

  // wipes out locations and sets primary location
  function _setDefaultLocation() {
    var locObj = {};
    locObj[defaultLoc.zip] = defaultLoc;
    _setLocations(locObj);
  }

  this.getLocations = function() {
    if (localStorage.getItem("locations") === null) {
      _setDefaultLocation();
    }

    return JSON.parse(localStorage.getItem("locations"));
  }

  this.addLocation = function(loc) {
    var arr = that.getLocations();
    arr[loc.zip] = loc
    _setLocations(arr);
  }

  this.removeLocation = function(zip) {
    var prefZip = that.getPrefLocation().zip;

    var arr = that.getLocations();
    delete arr[zip];
    _setLocations(arr);

    // if array is empty
    if (Object.keys(arr).length == 0) {
      _setDefaultLocation();
    }

    // if we delete preferred location, set to first item
    if (zip === prefZip) {
      var items = that.getLocations();
      var firstItem = items[(Object.keys(items)[0])];
      that.setPrefLocation(firstItem);
    }
  }

  this.getPrefLocation = function() {
    if (localStorage.getItem("preferredLocation") === null) {
      localStorage.setItem("preferredLocation", defaultLoc.zip)
    }

    return that.getLocations()[localStorage.getItem("preferredLocation")];
  }

  // set preferred location by item
  this.setPrefLocation = function(loc) {
    localStorage.setItem("preferredLocation", loc.zip);
    that.onPrefLocationChange.onEvent(loc);

    that.addLocation(loc);
  }
}

var LocationDB = new _LocationDB();


// utilities for gathering and searching for locations
var _LocationUtils = function() {
  var that = this;

  /**
   * gets location object based on google maps api search result
   * @param  {obj} results           google maps api search result
   * @return {LocObject}             closest approximation of location object result
   */
  this.getLocObj = function(results) {
    // track down zipCode, City, and State in results
    var zipCode = "";
    var City = "";
    var State = "";

    for (var i = 0; i < results[0].address_components.length; i++) {
      if ($.inArray("locality", results[0].address_components[i].types) != -1)
        City = results[0].address_components[i].long_name;
      if ($.inArray("administrative_area_level_1", results[0].address_components[i].types) != -1)
        State = results[0].address_components[i].short_name;
      if ($.inArray("postal_code", results[0].address_components[i].types) != -1)
        zipCode = results[0].address_components[i].long_name;

      if (zipCode != "" && City != "" && State != "")
        break;
    }

    return new LocObject(zipCode, City, State);
  }

  function _setPrefLoc(lat, lng, callback) {
    //taken from https://developers.google.com/maps/documentation/javascript/geocoding#ReverseGeocoding
    var geocoder = new google.maps.Geocoder();
    var latlng = new google.maps.LatLng(lat, lng);

    geocoder.geocode({'latLng': latlng}, function(results, status) {
      if (status == google.maps.GeocoderStatus.OK) {
        var locObj = that.getLocObj(results);
        LocationDB.setPrefLocation(locObj);
      }
      else {
          alert("Error due to: " + status);
      }
      callback();
    });
  }

  //taken from http://jsfiddle.net/gogs/jwt9f1o3/
  var tryAPIGeolocation = function(callback) {
  	jQuery.post( "https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyA-i12GCpIrJ5bqL5p93iJfKnjsd9yONXU",
    function(success) {
      _setPrefLoc(success.location.lat, success.location.lng, callback);
    })
    .fail(function(err) {
      alert("API Geolocation error! \n\n");
      console.log(err);
    });
  };

  var browserGeolocationFail = function(error, callback) {
    switch (error.code) {
      case error.TIMEOUT:
        alert("Browser geolocation error !\n\nTimeout.");
        break;
      case error.PERMISSION_DENIED:
        if(error.message.indexOf("Only secure origins are allowed") == 0) {
          tryAPIGeolocation(callback);
        }
        break;
      case error.POSITION_UNAVAILABLE:
        alert("Browser geolocation error !\n\nPosition unavailable.");
        break;
    }
  };


  /**
   * sets preferred location using geolocation lat/lng
   */
  this.setPrefLocByPos = function(callback) {
    if(navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {_setPrefLoc(pos.coords.latitude, pos.coords.longitude, callback); },
        function(error) { browserGeolocationFail(error, callback); },
        {maximumAge: 50000, timeout: 20000, enableHighAccuracy: true});
    }
    else {
      alert("Sorry, but your browser does not support this function.");
      callback();
    }
  }

  this.setSearchResults = function(searchString, callback) {
    if (searchString.length >= 3) {
      $.ajax({
        url: "http://gd.geobytes.com/AutoCompleteCity",
        dataType: "jsonp",
        crossDomain: true,
        data: {
          q: searchString
        }
      }).then(function(cities) {
        // all the search items
        var searchItems = [];
        var itemCount = cities.length;

        cities.map(function(cityString) {
          var items = cityString.split(",");
          var state = items[1].trim();
          var city = items[0].trim();

          $.ajax({
            url: "http://api.zippopotam.us/us/" + state + "/" + city,
            dataType: "json",
            success: function(returnItem) {
              var zipCode = returnItem["places"][0]["post code"];
              searchItems.push(new LocObject(zipCode, city, state));
              if (searchItems.length == itemCount) {
                callback(searchItems);
              }
            },
            error:function (xhr, ajaxOptions, thrownError){
                if(xhr.status==404) {
                    itemCount--;
                }
            }
          });
        });
      });
    }
  }
}

var LocationUtils = new _LocationUtils();


// holds onto async updated news items
var _NewsWeatherItems = function() {
  var that = this;

  this.weatherForecastNum = 2;

  this.onNewsLoad = new EventController();

  this.newsItems = [];
  for (var i = 0; i < 10; i++)
    this.newsItems.push(undefined);


  this.onWeatherLoad = new EventController();

  this.weatherItem = undefined;

  /**
   * requests the news ajax style
   * @param  {string} location zip code for location
   */
  this.requestNews = function(location) {
    var newsSource = "//query.yahooapis.com/v1/public/yql?q=select%20*%20from%20rss%20where%20url%20%3D%20'https%3A%2F%2Fnews.google.com%2Frss%2Flocal%2Fsection%2Fgeo%2F" + location + "%2F" + location + "%3Fned%3Dus%26hl%3Den%26gl%3DUS'&format=json&diagnostics=true&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

    $.get(newsSource, function (result) {
      that.newsItems = result.query.results.item;
      that.onNewsLoad.onEvent(that.newsItems);
    });
  }

  /**
   * requests the weather ajax style
   * @param  {string} location zip code
   */
  this.requestWeather = function(location) {
    var weatherSource = "//query.yahooapis.com/v1/public/yql?q=select%20*%20from%20weather.forecast%20where%20woeid%20in%20(select%20woeid%20from%20geo.places(1)%20where%20text%3D%22" + location + "%22)&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

    $.get(weatherSource, function (result) {
      // get to the actual data
      result = result.query.results.channel.item;

      // initialize the weatherItems
      that.weatherItem = {};
      that.weatherItem.description = result.description.replace("<![CDATA[", "").replace("]]>", "")
        .replace("http://us.rd.yahoo.com/dailynews/rss/weather/Country__Country/*", "");
      that.weatherItem.weatherImg = $(that.weatherItem.description).closest('img').attr('src');

      // just forecast to the number we want
      that.weatherItem.forecast = [];
      for (var i = 0; i < that.weatherForecastNum; i++) {
        that.weatherItem.forecast[i] = result.forecast[i];
        that.weatherItem.forecast[i].description = result.forecast[i].text;
      }

      that.weatherItem.conditionDegrees = result.condition.temp;
      that.weatherItem.conditionText = result.condition.text;
      that.weatherItem.linkText = "Go to Weather Page";
      that.weatherItem.link = result.link.substring(
        "http://us.rd.yahoo.com/dailynews/rss/weather/Country__Country/*".length);
        
      that.onWeatherLoad.onEvent(that.weatherItem);
    });
  }

  // keeps items up to date
  LocationDB.onPrefLocationChange.subscribe(function(prefLoc) {
    that.requestNews(prefLoc.zip);
    that.requestWeather(prefLoc.zip);
  });
}

var NewsWeatherItems = new _NewsWeatherItems();


/** Main application component. */
var App = React.createClass({
  getDefaultProps: function() {
    return {
      weatherLinkText: "Go to Yahoo Weather",
      newsLinkText: "Go to Article"
    };
  },

  componentDidMount: function() {
    var that = this;
    $.mobile.initializePage();

    // hack to make sure dynamically updated pages properly change title of document
    $('div[data-role="page"]').bind("pageshow", function () {
    		document.title = $.mobile.activePage.attr("data-title");
    });

    NewsWeatherItems.onWeatherLoad.subscribe(
      function(weather) { that.setState({weather : weather}); }
    );

    NewsWeatherItems.onNewsLoad.subscribe(
      function(news) { that.setState({news : news}); }
    );

    LocationDB.onPrefLocationChange.subscribe(
      function(loc) {
        that.setState({location : loc});
      }
    );
  },

  getInitialState: function() {
    return {
      news : NewsWeatherItems.newsItems,
      weather : NewsWeatherItems.weatherItem,
      location : LocationDB.getPrefLocation()
    };
  },

  componentDidUpdate: function() {
    $('#weatherNewsUL:visible').listview('refresh');
  },

  render: function() {
    var items = [];
    var pages = [];

    // take care of the weather stuff
    var pageID = "weatherPage";
    var pageLink = "#" + pageID;
    var title = "Weather for " + this.state.location.name;

    // push empty page if weather isn't loaded
    if (this.state.weather === undefined) {
      pages.push(<ContentPage key="WeatherPage" pageID={pageID} />);
    }
    else {
      items.push(<WeatherItem key="WeatherItem" data={this.state.weather} link={pageLink} />);
      pages.push(
        <ContentPage pageID={pageID} key="WeatherPage" header={title} description={this.state.weather.description}
          link={this.state.weather.link} linktext={this.props.weatherLinkText} />
        );
    }

    // text to be shown for button linking to outside article
    var linkText = this.props.newsLinkText;

    this.state.news.map(function(newsitem, index) {
      var newsID = "news" + index + "Page";
      var newsLink = "#" + newsID;

      if (newsitem === undefined) {
        pages.push(<ContentPage key={"ContentPage" + index} pageID={newsID} />);
      }
      else {
        items.push(<NewsItem key={"NewsItem" + index} data={newsitem} index={index} link={newsLink}/>);
        pages.push(
          <ContentPage pageID={newsID} key={"ContentPage" + index} header={newsitem.title} description={newsitem.description}
            link={newsitem.link} linktext={linkText} />
        );
      }
    });

    return (<div className="app">
              <div id="mainPage" data-role="page" data-title={"Weather and News for " + this.state.location.name}>
                <WeatherNewsHeader location={this.state.location} />
                <ul id="weatherNewsUL" data-role="listview">
                  {items}
                </ul>
              </div>
              <LocationPage/>
              {pages}
            </div>);
  }
});


var WeatherNewsHeader = React.createClass({
  render: function() {
    return (
      <div data-role="header">
      <h1 id="mainTitle" >{this.props.location.name}</h1>
      <a href="#LocationPage" id="LocationButton" data-icon="gear" data-transition="flip" className="ui-btn-right">Location</a>
      </div>
    );
  }
});


var ListItem = React.createClass({
  render: function() {
    var img = (this.props.img === undefined) ? undefined : (<img src={this.props.img}/>);

    return(
      <li>
        <a href={this.props.link} className="ui-btn ui-btn-icon-right ui-icon-carat-r">
  				{img}
  				<h2>{this.props.header}</h2>
  				{this.props.content}
  			</a>
      </li>
    );
  }
});


var WeatherItem = React.createClass({
  render: function() {
    var forecasts = this.props.data.forecast.map(function(item, i) {
      return (<p className="forecastParagraph" key={i}>{item.day}:&nbsp;&nbsp;{item.high}&deg; / {item.low}&deg;,&nbsp;&nbsp; {item.description}</p>);
    });

    var header = "Weather:  " + this.props.data.conditionDegrees + "° F,  " +       this.props.data.conditionText;

    return (
      <ListItem key="WeatherItem" link={this.props.link} img={this.props.data.weatherImg}
        header={header} content={forecasts}/>
    );
  }
});


var NewsItem = React.createClass({
  render: function() {
    var image = $(this.props.data.description).closest('img').attr('src');
    return (
      <ListItem link={this.props.link} img={image}
        header={this.props.data.title} content={''}/>
    );
  }
});


var ContentPage = React.createClass({
    render: function() {
      var contentHTML = (this.props.description === undefined) ?
        {__html: ""} :
        {__html: this.props.description};

      var button = (this.props.link === undefined) ?
        (<div/>) :
        (<div className="centeredItem">
          <a href={this.props.link} data-role="button" data-icon="star">
            {this.props.linktext}
          </a>
        </div>);

        return (
            <div data-role="page" id={this.props.pageID} data-title={this.props.header}>
              <div data-role="header">
                <h1>{this.props.header}</h1>
                <a href="#" data-rel="back" data-icon="back" className="ui-btn-left">Back</a>
              </div>
              <div className="centeredItem">
                <div dangerouslySetInnerHTML={contentHTML} />
              </div>
              <br/>
              {button}
            </div>
        );
    }
});


var LocationPage = React.createClass({
    onLocationChange: function(locs) {
      this.setState({ locs : locs});
    },

    onPrefLocationChange : function(loc) {
      this.setState({ prefZip : loc.zip});
    },

    componentDidMount: function() {
      var that = this;

      $("#CurrentLocButton").click(function() {
        LocationUtils.setPrefLocByPos(function() { $.mobile.loading("hide"); });
        $.mobile.loading( "show");
      });

      LocationDB.onLocationChange.subscribe(this.onLocationChange);
      LocationDB.onPrefLocationChange.subscribe(this.onPrefLocationChange);

      $("#autocomplete").on("filterablebeforefilter", function (e, data) {
          var value = $(data.input).val();
          if ( value && value.length > 2 ) {
            that.setState({isSearching : true });
            LocationUtils.setSearchResults(value, function(items) {
              that.setState({searchResults : items });
            });
          }
          else {
            that.setState({
              isSearching : false,
              searchResults : []
            });
          }
      });
    },

    componentWillUnmount : function() {
      LocationDB.onLocationChange.unsubscribe(this.onLocationChange);
      LocationDB.onPrefLocationChange.unsubscribe(this.onPrefLocationChange);
    },

    componentDidUpdate : function() {
      $("#SavedLocations:visible").listview("refresh");
      $("#autocomplete:visible").listview("refresh");
      $("#autocomplete:visible").trigger("updatelayout");
    },

    getInitialState: function() {
        return {
          locs : LocationDB.getLocations(),
          prefZip : LocationDB.getPrefLocation().zip,
          searchResults : [],
          isSearching : false
        };
    },

    render: function() {
      var that = this;

      var searchItems = undefined;
      if (this.state.isSearching) {
        if (this.state.searchResults.length === 0) {
          searchItems = (<li><div className='ui-loader'><span className='ui-icon ui-icon-loading'></span></div></li>)
        }
        else {
          searchItems = this.state.searchResults.map(function(locObj) {
            function setLoc() {
              LocationDB.setPrefLocation(locObj);
              $("#autocomplete-input").val("");
              that.setState({
                isSearching : false,
                searchResults : []
              })
            }

            return (<li data-icon="false"><a onClick={setLoc} href="#">{locObj.name}</a></li>);
          });
        }
      }

      var prevLocations = Object.keys(this.state.locs).map(function(zip, index) {
        var item = that.state.locs[zip];
        var itemSelect = function(e) {
          LocationDB.setPrefLocation(item);
        }

        var itemRemove = function() {
          LocationDB.removeLocation(zip);
        }

        if (zip == that.state.prefZip) {
          return (<li data-icon="false" key={index}><a className="activeListItem" href="#">{item.name}</a><a href="#" className="activeListItem" onClick={itemRemove} data-icon="delete"/></li>);
        }
        else {
          return (<li data-icon="false" key={index}><a href="#" onClick={itemSelect}>{item.name}</a><a href="#" onClick={itemRemove} data-icon="delete"/></li>);
        }
      });

        return (
          <div data-role="page" data-title="Set Location" id="LocationPage">
            {/* header */}
            <div data-role="header">
              <a href="#" data-rel="back" data-icon="back" className="ui-btn-left">Back</a>
              <h1>Set Location</h1>
            </div>

            {/* Locations information */}
            <h3 className="centeredText">Saved Locations</h3>
            <ul data-role="listview" data-inset="true" id="SavedLocations" className="centeredItem margined">
              {prevLocations}
            </ul>

            {/* current location button */}
            <button id="CurrentLocButton" className="ui-btn ui-icon-location ui-btn-icon-left centeredItem margined">Use Current Location</button>

            {/* city search */}
            <form className="ui-filterable centeredItem">
                <input id="autocomplete-input" data-type="search" placeholder="Find a city..." />
            </form>
            <ul id="autocomplete" data-role="listview" data-inset="true" data-filter="true" data-input="#autocomplete-input" className="centeredItem">
              {searchItems}
            </ul>
          </div>
        );
    }
});

$(document).ready(function() {
  // start up the app
  ReactDOM.render(<App />, document.getElementById('content'));

  // set up the first request
  NewsWeatherItems.requestNews(LocationDB.getPrefLocation().zip);
  NewsWeatherItems.requestWeather(LocationDB.getPrefLocation().zip);
});
