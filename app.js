'use strict';

// simple event controller to handle pub sub

function EventController() {
  this.listeners = [];

  this.onEvent = function (e) {
    this.listeners.map(function (listener) {
      listener(e);
    });
  };

  this.subscribe = function (listener) {
    this.listeners.push(listener);
  };

  this.unsubscribe = function (listener) {
    var index = this.listeners.indexOf(listener);

    if (index > -1) this.listeners.splice(index, 1);

    return index != -1;
  };
}

// handles location information
function LocObject(zipCode, city, state) {
  this.zip = zipCode;
  this.city = city;
  this.state = state;
  this.name = city + ", " + state;
}

var defaultLoc = new LocObject("02138", "Cambridge", "MA");

// manages local storage for locations
var _LocationDB = function _LocationDB() {
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

  this.getLocations = function () {
    if (localStorage.getItem("locations") === null) {
      _setDefaultLocation();
    }

    return JSON.parse(localStorage.getItem("locations"));
  };

  this.addLocation = function (loc) {
    var arr = that.getLocations();
    arr[loc.zip] = loc;
    _setLocations(arr);
  };

  this.removeLocation = function (zip) {
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
      var firstItem = items[Object.keys(items)[0]];
      that.setPrefLocation(firstItem);
    }
  };

  this.getPrefLocation = function () {
    if (localStorage.getItem("preferredLocation") === null) {
      localStorage.setItem("preferredLocation", defaultLoc.zip);
    }

    return that.getLocations()[localStorage.getItem("preferredLocation")];
  };

  // set preferred location by item
  this.setPrefLocation = function (loc) {
    localStorage.setItem("preferredLocation", loc.zip);
    that.onPrefLocationChange.onEvent(loc);

    that.addLocation(loc);
  };
};

var LocationDB = new _LocationDB();

// utilities for gathering and searching for locations
var _LocationUtils = function _LocationUtils() {
  var that = this;

  /**
   * gets location object based on google maps api search result
   * @param  {obj} results           google maps api search result
   * @return {LocObject}             closest approximation of location object result
   */
  this.getLocObj = function (results) {
    // track down zipCode, City, and State in results
    var zipCode = "";
    var City = "";
    var State = "";

    for (var i = 0; i < results[0].address_components.length; i++) {
      if ($.inArray("locality", results[0].address_components[i].types) != -1) City = results[0].address_components[i].long_name;
      if ($.inArray("administrative_area_level_1", results[0].address_components[i].types) != -1) State = results[0].address_components[i].short_name;
      if ($.inArray("postal_code", results[0].address_components[i].types) != -1) zipCode = results[0].address_components[i].long_name;

      if (zipCode != "" && City != "" && State != "") break;
    }

    return new LocObject(zipCode, City, State);
  };

  function _setPrefLoc(pos, callback) {
    //taken from https://developers.google.com/maps/documentation/javascript/geocoding#ReverseGeocoding
    var geocoder = new google.maps.Geocoder();
    var latlng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);

    geocoder.geocode({ 'latLng': latlng }, function (results, status) {
      if (status == google.maps.GeocoderStatus.OK) {
        var locObj = that.getLocObj(results);
        LocationDB.setPrefLocation(locObj);
      } else {
        alert("Error due to: " + status);
      }
      callback();
    });
  }

  /**
   * sets preferred location using geolocation lat/lng
   */
  this.setPrefLocByPos = function (callback) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        _setPrefLoc(pos, callback);
      });
    } else {
      alert("Sorry, but your browser does not support this function.");
      callback();
    }
  };

  this.setSearchResults = function (searchString, callback) {
    if (searchString.length >= 3) {
      $.ajax({
        url: "http://gd.geobytes.com/AutoCompleteCity",
        dataType: "jsonp",
        crossDomain: true,
        data: {
          q: searchString
        }
      }).then(function (cities) {
        // all the search items
        var searchItems = [];
        var itemCount = cities.length;

        cities.map(function (cityString) {
          var items = cityString.split(",");
          var state = items[1].trim();
          var city = items[0].trim();

          $.ajax({
            url: "http://api.zippopotam.us/us/" + state + "/" + city,
            dataType: "json",
            success: function success(returnItem) {
              var zipCode = returnItem["places"][0]["post code"];
              searchItems.push(new LocObject(zipCode, city, state));
              if (searchItems.length == itemCount) {
                callback(searchItems);
              }
            },
            error: function error(xhr, ajaxOptions, thrownError) {
              if (xhr.status == 404) {
                itemCount--;
              }
            }
          });
        });
      });
    }
  };
};

var LocationUtils = new _LocationUtils();

// holds onto async updated news items
var _NewsWeatherItems = function _NewsWeatherItems() {
  var that = this;

  this.weatherForecastNum = 2;

  this.onNewsLoad = new EventController();

  this.newsItems = [];
  for (var i = 0; i < 10; i++) {
    this.newsItems.push(undefined);
  }this.onWeatherLoad = new EventController();

  this.weatherItem = undefined;

  /**
   * requests the news ajax style
   * @param  {string} location zip code for location
   */
  this.requestNews = function (location) {
    var newsSource = "http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20rss%20where%20url%20%3D%20'http%3A%2F%2Fnews.google.com%2Fnews%3Fgeo%3D" + location + "%26output%3Drss'&format=json&diagnostics=true&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

    $.get(newsSource, function (result) {
      that.newsItems = result.query.results.item;
      that.onNewsLoad.onEvent(that.newsItems);
    });
  };

  /**
   * requests the weather ajax style
   * @param  {string} location zip code
   */
  this.requestWeather = function (location) {
    var weatherSource = "https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20weather.forecast%20where%20woeid%20in%20(select%20woeid%20from%20geo.places(1)%20where%20text%3D%22" + location + "%22)&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

    $.get(weatherSource, function (result) {
      // get to the actual data
      result = result.query.results.channel.item;

      // initialize the weatherItems
      that.weatherItem = {};
      that.weatherItem.description = result.description.replace("<![CDATA[", "").replace("]]>", "");;
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
      that.weatherItem.link = result.link;

      that.onWeatherLoad.onEvent(that.weatherItem);
    });
  };

  // keeps items up to date
  LocationDB.onPrefLocationChange.subscribe(function (prefLoc) {
    that.requestNews(prefLoc.zip);
    that.requestWeather(prefLoc.zip);
  });
};

var NewsWeatherItems = new _NewsWeatherItems();

/** Main application component. */
var App = React.createClass({
  displayName: "App",

  getDefaultProps: function getDefaultProps() {
    return {
      weatherLinkText: "Go to Yahoo Weather",
      newsLinkText: "Go to Article"
    };
  },

  componentDidMount: function componentDidMount() {
    var that = this;
    $.mobile.initializePage();

    // hack to make sure dynamically updated pages properly change title of document
    $('div[data-role="page"]').bind("pageshow", function () {
      document.title = $.mobile.activePage.attr("data-title");
    });

    NewsWeatherItems.onWeatherLoad.subscribe(function (weather) {
      that.setState({ weather: weather });
    });

    NewsWeatherItems.onNewsLoad.subscribe(function (news) {
      that.setState({ news: news });
    });

    LocationDB.onPrefLocationChange.subscribe(function (loc) {
      that.setState({ location: loc });
    });
  },

  getInitialState: function getInitialState() {
    return {
      news: NewsWeatherItems.newsItems,
      weather: NewsWeatherItems.weatherItem,
      location: LocationDB.getPrefLocation()
    };
  },

  componentDidUpdate: function componentDidUpdate() {
    $('#weatherNewsUL:visible').listview('refresh');
  },

  render: function render() {
    var items = [];
    var pages = [];

    // take care of the weather stuff
    var pageID = "weatherPage";
    var pageLink = "#" + pageID;
    var title = "Weather for " + this.state.location.name;

    // push empty page if weather isn't loaded
    if (this.state.weather === undefined) {
      pages.push(React.createElement(ContentPage, { pageID: pageID }));
    } else {
      items.push(React.createElement(WeatherItem, { data: this.state.weather, link: pageLink }));
      pages.push(React.createElement(ContentPage, { pageID: pageID, header: title, description: this.state.weather.description,
        link: this.state.weather.link, linktext: this.props.weatherLinkText }));
    }

    // text to be shown for button linking to outside article
    var linkText = this.props.newsLinkText;

    this.state.news.map(function (newsitem, index) {
      var newsID = "news" + index + "Page";
      var newsLink = "#" + newsID;

      if (newsitem === undefined) {
        pages.push(React.createElement(ContentPage, { pageID: newsID }));
      } else {
        items.push(React.createElement(NewsItem, { data: newsitem, index: index, link: newsLink }));
        pages.push(React.createElement(ContentPage, { pageID: newsID, header: newsitem.title, description: newsitem.description,
          link: newsitem.link, linktext: linkText }));
      }
    });

    return React.createElement(
      "div",
      { className: "app" },
      React.createElement(
        "div",
        { id: "mainPage", "data-role": "page", "data-title": "Weather and News for " + this.state.location.name },
        React.createElement(WeatherNewsHeader, { location: this.state.location }),
        React.createElement(
          "ul",
          { id: "weatherNewsUL", "data-role": "listview" },
          items
        )
      ),
      React.createElement(LocationPage, null),
      pages
    );
  }
});

var WeatherNewsHeader = React.createClass({
  displayName: "WeatherNewsHeader",

  render: function render() {
    return React.createElement(
      "div",
      { "data-role": "header" },
      React.createElement(
        "h1",
        { id: "mainTitle" },
        this.props.location.name
      ),
      React.createElement(
        "a",
        { href: "#LocationPage", id: "LocationButton", "data-icon": "gear", "data-transition": "flip", className: "ui-btn-right" },
        "Location"
      )
    );
  }
});

var ListItem = React.createClass({
  displayName: "ListItem",

  render: function render() {
    var img = this.props.img === undefined ? undefined : React.createElement("img", { src: this.props.img });

    return React.createElement(
      "li",
      null,
      React.createElement(
        "a",
        { href: this.props.link, className: "ui-btn ui-btn-icon-right ui-icon-carat-r" },
        img,
        React.createElement(
          "h2",
          null,
          this.props.header
        ),
        this.props.content
      )
    );
  }
});

var WeatherItem = React.createClass({
  displayName: "WeatherItem",

  render: function render() {
    var forecasts = this.props.data.forecast.map(function (item) {
      return React.createElement(
        "p",
        { className: "forecastParagraph" },
        item.day,
        ":  ",
        item.high,
        "° / ",
        item.low,
        "°,   ",
        item.description
      );
    });

    var header = "Weather:  " + this.props.data.conditionDegrees + "° F,  " + this.props.data.conditionText;

    return React.createElement(ListItem, { link: this.props.link, img: this.props.data.weatherImg,
      header: header, content: forecasts });
  }
});

var NewsItem = React.createClass({
  displayName: "NewsItem",

  render: function render() {
    var image = $(this.props.data.description).closest('img').attr('src');
    return React.createElement(ListItem, { link: this.props.link, img: image,
      header: this.props.data.title, content: '' });
  }
});

var ContentPage = React.createClass({
  displayName: "ContentPage",

  render: function render() {
    var contentHTML = this.props.description === undefined ? { __html: "" } : { __html: this.props.description };

    var button = this.props.link === undefined ? React.createElement("div", null) : React.createElement(
      "div",
      { className: "centeredItem" },
      React.createElement(
        "a",
        { href: this.props.link, "data-role": "button", "data-icon": "star" },
        this.props.linktext
      )
    );

    return React.createElement(
      "div",
      { "data-role": "page", id: this.props.pageID, "data-title": this.props.header, headerTheme: "a" },
      React.createElement(
        "div",
        { "data-role": "header" },
        React.createElement(
          "h1",
          null,
          this.props.header
        ),
        React.createElement(
          "a",
          { href: "#", "data-rel": "back", "data-icon": "back", className: "ui-btn-left" },
          "Back"
        )
      ),
      React.createElement(
        "div",
        { className: "centeredItem" },
        React.createElement("div", { dangerouslySetInnerHTML: contentHTML })
      ),
      React.createElement("br", null),
      button
    );
  }
});

var LocationPage = React.createClass({
  displayName: "LocationPage",

  onLocationChange: function onLocationChange(locs) {
    this.setState({ locs: locs });
  },

  onPrefLocationChange: function onPrefLocationChange(loc) {
    this.setState({ prefZip: loc.zip });
  },

  componentDidMount: function componentDidMount() {
    var that = this;

    $("#CurrentLocButton").click(function () {
      LocationUtils.setPrefLocByPos(function () {
        $.mobile.loading("hide");
      });
      $.mobile.loading("show");
    });

    LocationDB.onLocationChange.subscribe(this.onLocationChange);
    LocationDB.onPrefLocationChange.subscribe(this.onPrefLocationChange);

    $("#autocomplete").on("filterablebeforefilter", function (e, data) {
      var value = $(data.input).val();
      if (value && value.length > 2) {
        that.setState({ isSearching: true });
        LocationUtils.setSearchResults(value, function (items) {
          that.setState({ searchResults: items });
        });
      } else {
        that.setState({
          isSearching: false,
          searchResults: []
        });
      }
    });
  },

  componentWillUnmount: function componentWillUnmount() {
    LocationDB.onLocationChange.unsubscribe(this.onLocationChange);
    LocationDB.onPrefLocationChange.unsubscribe(this.onPrefLocationChange);
  },

  componentDidUpdate: function componentDidUpdate() {
    $("#SavedLocations:visible").listview("refresh");
    $("#autocomplete:visible").listview("refresh");
    $("#autocomplete:visible").trigger("updatelayout");
  },

  getInitialState: function getInitialState() {
    return {
      locs: LocationDB.getLocations(),
      prefZip: LocationDB.getPrefLocation().zip,
      searchResults: [],
      isSearching: false
    };
  },

  render: function render() {
    var that = this;

    var searchItems = undefined;
    if (this.state.isSearching) {
      if (this.state.searchResults.length === 0) {
        searchItems = React.createElement(
          "li",
          null,
          React.createElement(
            "div",
            { className: "ui-loader" },
            React.createElement("span", { className: "ui-icon ui-icon-loading" })
          )
        );
      } else {
        searchItems = this.state.searchResults.map(function (locObj) {
          function setLoc() {
            LocationDB.setPrefLocation(locObj);
            $("#autocomplete-input").val("");
            that.setState({
              isSearching: false,
              searchResults: []
            });
          }

          return React.createElement(
            "li",
            { "data-icon": "false" },
            React.createElement(
              "a",
              { onClick: setLoc, href: "#" },
              locObj.name
            )
          );
        });
      }
    }

    var prevLocations = Object.keys(this.state.locs).map(function (zip) {
      var item = that.state.locs[zip];
      var itemSelect = function itemSelect(e) {
        LocationDB.setPrefLocation(item);
      };

      var itemRemove = function itemRemove() {
        LocationDB.removeLocation(zip);
      };

      if (zip == that.state.prefZip) {
        return React.createElement(
          "li",
          { "data-icon": "false" },
          React.createElement(
            "a",
            { className: "activeListItem", href: "#" },
            item.name
          ),
          React.createElement("a", { href: "#", className: "activeListItem", onClick: itemRemove, "data-icon": "delete" })
        );
      } else {
        return React.createElement(
          "li",
          { "data-icon": "false" },
          React.createElement(
            "a",
            { href: "#", onClick: itemSelect },
            item.name
          ),
          React.createElement("a", { href: "#", onClick: itemRemove, "data-icon": "delete" })
        );
      }
    });

    return React.createElement(
      "div",
      { "data-role": "page", "data-title": "Set Location", id: "LocationPage", headerTheme: "a" },
      React.createElement(
        "div",
        { "data-role": "header" },
        React.createElement(
          "a",
          { href: "#", "data-rel": "back", "data-icon": "back", className: "ui-btn-left" },
          "Back"
        ),
        React.createElement(
          "h1",
          null,
          "Set Location"
        )
      ),
      React.createElement(
        "h3",
        { className: "centeredText" },
        "Saved Locations"
      ),
      React.createElement(
        "ul",
        { "data-role": "listview", "data-inset": "true", id: "SavedLocations", className: "centeredItem margined" },
        prevLocations
      ),
      React.createElement(
        "button",
        { id: "CurrentLocButton", className: "ui-btn ui-icon-location ui-btn-icon-left centeredItem margined" },
        "Use Current Location"
      ),
      React.createElement(
        "form",
        { className: "ui-filterable centeredItem" },
        React.createElement("input", { id: "autocomplete-input", "data-type": "search", placeholder: "Find a city..." })
      ),
      React.createElement(
        "ul",
        { id: "autocomplete", "data-role": "listview", "data-inset": "true", "data-filter": "true", "data-input": "#autocomplete-input", className: "centeredItem" },
        searchItems
      )
    );
  }
});

$(document).ready(function () {
  // start up the app
  ReactDOM.render(React.createElement(App, null), document.getElementById('content'));

  // set up the first request
  NewsWeatherItems.requestNews(LocationDB.getPrefLocation().zip);
  NewsWeatherItems.requestWeather(LocationDB.getPrefLocation().zip);
});
