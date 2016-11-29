(function(window, $, OSC, cytoscape) {
  'use strict';

  var SCORE_PATH = '/score';
  var ANIMATION_DURATION = 1000;
  var WS_ADDRESS = '192.168.178.115';
  var WS_PORT = 9090;

  // private

  var graph;

  function loadScore() {
    return $.ajax({
      url: SCORE_PATH,
      dataType: 'json',
    });
  }

  function goToNode(id) {
    graph.animate({
      center: {
        eles: graph.nodes("[id='" + id + "']"),
      }
    }, {
      duration: ANIMATION_DURATION,
    });

    graph.$("[id='" + id + "']").select();
  }

  function changeDensity(density) {
    $('body').css('background-color', 'rgba(255, 50, 50, ' + density + ')');
    $('#density').html(Math.round(density * 100) / 100);
  }

  function connectOSC() {
    var osc = new OSC();

    osc.on('/brain/node', function(data) {
      goToNode(data.args[0]);
    });

    osc.on('/brain/density', function(data) {
      changeDensity(data.args[0]);
    });

    osc.connect(WS_ADDRESS, WS_PORT);
  }

  // public

  var app = {
    initialize: function() {
      // prepare node graph

      graph = cytoscape({
        container: $('#graph'),
        style: [
          {
            selector: 'node',
            style: {
              'width': 150,
              'height': 150,
              'background-color': '#ff1122',
              'label': 'data(id)',
              'text-valign': 'center',
              'color': '#fff',
              'text-background-color': '#000',
              'text-background-opacity': 1,
              'selection-color': '#333',
            },
          }, {
            selector: 'edge',
            style: {
              'width': 7,
              'line-color': '#000',
              'target-arrow-color': '#000',
              'target-arrow-shape': 'triangle',
              'curve-style': 'unbundled-bezier',
              'source-label': 'data(name)',
              'color': '#fff',
              'text-background-color': '#000',
              'text-background-opacity': 1,
              'source-text-offset': 30
            },
          },
        ],
        zoomingEnabled: true,
        userZoomingEnabled: false,
        panningEnabled: true,
        userPanningEnabled: true,
        autounselectify: true,
        autoungrabify: true,
      });

      // load score data

      loadScore().done(function(score) {
        var edges = [];

        Object.keys(score.nodes).forEach(function(id) {
          var node = score.nodes[id];

          graph.add({
            group: 'nodes',
            data: {
              id: id,
            },
          });

          node.edges.forEach(function(edge) {
            edges.push({
              group: 'edges',
              data: {
                name: edge.treshold.join('-'),
                source: id,
                target: edge.node,
              }
            });
          });
        });

        graph.add(edges);

        graph.layout({ name: 'circle' });

        connectOSC();
      });
    }
  };

  window.app = window.app || app;
})(window, jQuery, OSC, cytoscape);
