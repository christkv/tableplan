package com.tableplan.odm

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.ReplaceOptions
import org.bson.Document
import kotlin.reflect.KClass
import kotlin.reflect.full.findAnnotation

class MongoModel<T : StringIdDocument>(
    private val database: MongoDatabase,
    private val type: KClass<T>,
    private val mapper: DocumentMapper = DocumentMapper(),
) {
    private val collectionName =
        requireNotNull(type.findAnnotation<MongoDocument>()) {
            "${type.qualifiedName} requires @MongoDocument"
        }.collection

    private val collection get() = database.getCollection(collectionName)

    fun insert(value: T): T {
        value.requireValidId()
        collection.insertOne(mapper.toDocument(value))
        return value
    }

    fun save(value: T): T {
        val id = value.requireValidId()
        collection.replaceOne(eq("_id", id), mapper.toDocument(value), ReplaceOptions().upsert(true))
        return value
    }

    fun findById(id: String): T? =
        collection.find(eq("_id", id)).first()?.let { mapper.fromDocument(it, type) }

    fun deleteById(id: String): Boolean =
        collection.deleteOne(eq("_id", id)).deletedCount == 1L

    fun rawCollection() = collection
}

