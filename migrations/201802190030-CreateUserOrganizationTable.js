'use strict';

module.exports = {
    up: function (queryInterface, Sequelize) {
        return queryInterface.createTable('user_organization',
            {
                id: {
                    type: Sequelize.UUID,
                    primaryKey: true,
                    defaultValue: Sequelize.UUIDV4
                },
                role: {
                    type: Sequelize.STRING(10)
                },
                user_id: {
                    type: Sequelize.UUID,
                    references: {
                        model: 'user',
                        key: 'id'
                    }
                },
                organization_id: {
                    type: Sequelize.UUID,
                    references: {
                        model: 'organization',
                        key: 'id'
                    }
                }
            },
            {
                sync: {force: true}
            }
        );
    },

    down: function (queryInterface, Sequelize) {
        return queryInterface.dropTable('user_organization');
    }
};