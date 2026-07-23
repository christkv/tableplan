package com.tableplan.importer

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.UpdateOneModel
import com.mongodb.client.model.Updates
import org.bson.Document
import org.springframework.stereotype.Service

@Service
class FacetRefresher(
    private val database: MongoDatabase,
) {
    fun refresh(): Int {
        val counts =
            database.getCollection("recipes").aggregate(
                listOf(
                    Document("\$match", Document("visibility", "catalog").append("status", "active")),
                    Document("\$unwind", "\$tags"),
                    Document("\$group", Document("_id", "\$tags").append("recipeCount", Document("\$sum", 1))),
                ),
            ).toList()
        val tags = database.getCollection("tags")
        if (counts.isNotEmpty()) {
            tags.bulkWrite(
                counts.map {
                    UpdateOneModel(
                        Filters.eq("name", it.getString("_id")),
                        Updates.set("recipeCount", (it["recipeCount"] as Number).toInt()),
                    )
                },
            )
        }
        tags.updateMany(
            if (counts.isEmpty()) Document() else Filters.nin("name", counts.map { it.getString("_id") }),
            Updates.set("recipeCount", 0),
        )
        return counts.size
    }
}
