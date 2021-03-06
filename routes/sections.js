var express = require('express');
var router = express.Router();
var async = require('async');
var path = require('path');
var _ = require('lodash');

var db = require('../models');
var parseSwipe = require('../parse-swipe');
var fetchIDPhoto = require('../fetch-id-photo');
var writeCSV = require('../write-csv');
var email = require('../email');
var secretWord = require('../secret-word');

router.use(require('../middleware/require-auth'));

router.get('/:id', function(req, res) {
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        res.send(section);
    });
});

router.put('/:id', function(req, res) {
    if (!req.body.name) return res.status(400).end();
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        section.updateAttributes({
            name: req.body.name
        }).then(function(section) {
            res.send(section);
        });
    });
});

router.get('/:id/checkins', function(req, res) {
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        var last = req.query.last;
        db.Checkin.findAll({
            where: {sectionId: req.params.id},
            order: last ? [['createdAt', 'DESC']] : null,
            limit: last ? 5 : null,
            raw: true
        }).then(function(checkins) {
            async.each(checkins, function(checkin, callback) {
                db.Student.find({
                    where: {
                        courseId: section.courseId,
                        uin: checkin.uin
                    }
                }).then(function(student) {
                    if (student) {
                        checkin.netid = student.netid;
                        checkin.fullName = student.fullName;
                    } else {
                        checkin.netid = '';
                        checkin.fullName = '';
                    }
                    callback();
                });
            }, function() {
                res.send({checkins: checkins});
            });
        });
    });
});

router.get('/:id/checkins.csv', function(req, res) {
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        var query = (
            'SELECT sections.name AS sectionName, checkins.uin, ' +
            'students.netid, checkins.createdAt AS timestamp, ' +
            'checkins.secretWord ' +
            'FROM checkins ' +
            'JOIN sections ON checkins.sectionId = sections.id ' +
            'LEFT JOIN students ON ' +
            'students.courseId = sections.courseId ' +
            'AND students.uin = checkins.uin ' +
            'WHERE sections.id = ? ORDER BY timestamp'
        );
        db.sequelize.query(query, {
            replacements: [req.params.id],
            type: db.sequelize.QueryTypes.SELECT
        }).then(function(checkins) {
            res.attachment(section.name.replace(/\//g, '-') + '.csv');
            writeCSV(checkins, res);
        });
    });
});

router.post('/:id/checkins', function(req, res) {
    if (!req.body.swipeData) return res.status(400).end();
    db.Section.findForUser({
        where: {id: req.params.id},
        include: [db.Course]
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        parseSwipe(req.body.swipeData, section.courseId, function(uin) {
            if (!uin) return res.status(400).end();
            db.Checkin.findOrCreate({
                where: {
                    sectionId: req.params.id,
                    uin: uin
                },
                defaults: {
                    userId: req.user.id,
                    secretWord: section.course.enableSecretWords ? secretWord() : null
                }
            }).spread(function(checkin, created) {
                checkin = checkin.get();
                if (!created) return res.status(409).send(checkin);
                db.Student.find({
                    where: {
                        courseId: section.courseId,
                        uin: checkin.uin
                    }
                }).then(function(student) {
                    if (student) {
                        checkin.netid = student.netid;
                        checkin.fullName = student.fullName;
                        email.sendConfirmationEmail(checkin);
                    } else {
                        checkin.netid = '';
                        checkin.fullName = '';
                    }
                    res.send(checkin);
                });
            });
        });
    });
});

router.get('/:id/comments', function(req, res) {
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        section.getComments({
            include: [db.User]
        }).then(function(comments) {
            res.send({comments: comments});
        });
    });
});

router.post('/:id/comments', function(req, res) {
    if (!req.body.text) return res.status(400).end();
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        db.Comment.create({
            userId: req.user.id,
            sectionId: section.id,
            text: req.body.text
        }).then(function(comment) {
            res.send(_.assign({
                user: req.user
            }, comment.dataValues));
        });
    });
});

router.get('/:id/students/:uin/photo.jpg', function(req, res) {
    db.Section.findForUser({
        where: {id: req.params.id}
    }, req.user).spread(function(section, allowed) {
        if (!section) return res.status(404).end();
        if (!allowed) return res.status(403).end();
        var uin = req.params.uin;
        db.Student.find({
            where: {
                courseId: section.courseId,
                uin: uin
            }
        }).then(function(student) {
            // Do not return ID photo if student is not in the roster
            if (!student) {
                return res.sendFile('no_photo.jpg', {
                    root: path.join(__dirname, '../public/')
                });
            }

            // Use locally stored photos
            res.sendFile(uin + '.jpg', {
                root: path.join(__dirname, '../photos')
            }, function(err) {
                if (err) {
                    return res.sendFile('no_photo.jpg', {
                        root: path.join(__dirname, '../public/')
                    });
                }
            });

            //fetchIDPhoto(uin, function(error, response, body) {
                //if (response.headers['content-type'] !== 'image/jpeg') {
                    //// Session cookie is not valid
                    //return res.sendFile('no_photo.jpg', {
                        //root: path.join(__dirname, '../public/')
                    //});
                //}
                //res.type('image/jpeg');
                //res.send(body);
            //});
        });
    });
});

module.exports = {
    prefix: '/api/sections',
    router: router
};
