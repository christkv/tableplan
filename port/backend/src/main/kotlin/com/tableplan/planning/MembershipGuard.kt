package com.tableplan.planning

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import org.bson.Document
import org.springframework.stereotype.Component

@Component
class MembershipGuard(
    database: MongoDatabase,
) {
    private val memberships = database.getCollection("household_memberships")

    fun require(principal: TableplanPrincipal): Document =
        memberships.find(
            Filters.and(
                Filters.eq("userId", principal.userId),
                Filters.eq("householdId", principal.householdId),
            ),
        ).first() ?: throw ApiException(403, "household_access_denied", "Household access denied.")
}

