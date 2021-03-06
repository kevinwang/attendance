/** @jsx React.DOM */

var React = require('react');
var $ = require('jquery');

var baseUrl = require('../baseurl');

var AddStaffForm = React.createClass({
    propTypes: {
        courseId: React.PropTypes.number.isRequired,
        onAddStaff: React.PropTypes.func.isRequired
    },

    getInitialState: function() {
        return {
            expanded: false,
            netid: ''
        };
    },

    handleExpand: function(e) {
        this.setState({expanded: true});
    },

    componentDidUpdate: function(prevProps, prevState) {
        if (this.state.expanded && !prevState.expanded) {
            this.refs.netid.focus();
        }
    },

    handleNetIDChange: function(e) {
        this.setState({netid: e.target.value});
    },

    handleSubmit: function(e) {
        e.preventDefault();
        if (!this.state.netid) {
            return;
        }

        var id = this.props.courseId;
        $.ajax({
            type: 'POST',
            url: baseUrl + '/api/courses/' + id + '/staff',
            data: {netid: this.state.netid}
        })
        .done(function(result) {
            this.props.onAddStaff(result);
            this.setState({netid: ''});
        }.bind(this));
    },

    render: function() {
        var body;
        if (!this.state.expanded) {
            body = <button
                className="btn btn-default"
                onClick={this.handleExpand}>
                Add staff
            </button>;
        } else {
            body = <form onSubmit={this.handleSubmit}>
                <input
                    type="text"
                    className="form-control"
                    id="netid"
                    ref="netid"
                    placeholder="NetID"
                    value={this.state.netid}
                    onChange={this.handleNetIDChange} />
            </form>;
        }

        return <div className="add-staff-form">
            {body}
        </div>;
    }
});

module.exports = AddStaffForm;
